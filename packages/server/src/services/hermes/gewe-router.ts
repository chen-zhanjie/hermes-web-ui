import { randomInt } from 'crypto'
import { existsSync } from 'fs'
import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { join, resolve } from 'path'
import YAML from 'js-yaml'
import { getActiveProfileDir, getProfileDir } from './hermes-profile'
import { logger } from '../logger'

const HERMES_BASE = process.env.HERMES_HOME || resolve(homedir(), '.hermes')
const ROUTER_DIR = join(HERMES_BASE, 'platforms', 'gewe-router')
const STORE_PATH = join(ROUTER_DIR, 'bindings.json')
const DEFAULT_API_BASE_URL = 'https://api.geweapi.com'
const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const DEFAULT_INVITE_TTL_SECONDS = 3600
const PROCESSED_TTL_SECONDS = 600

export interface GeweBinding {
  user_id: string
  profile: string
  user_name?: string
  bound_at: number
  updated_at?: number
  source?: 'manual' | 'invite'
}

export interface GeweInvite {
  code: string
  profile: string
  label?: string
  created_at: number
  expires_at: number
}

interface GeweRouterStore {
  bindings: Record<string, GeweBinding>
  invites: Record<string, GeweInvite>
  processed: Record<string, number>
}

interface GeweOptions {
  token: string
  appId: string
  apiBaseUrl: string
  callbackSecret: string
  botWxids: Set<string>
  groupPolicy: string
  groupAllowedChats: Set<string>
  groupRequireMention: boolean
}

interface NormalizedGeweInbound {
  accountId: string
  fromUser: string
  fromGroup: string
  toUser: string
  peerId: string
  senderId: string
  conversationType: 'dm' | 'group'
  messageType: string
  messageId: string
  text: string
  mentionedUserIds: Set<string>
  raw: Record<string, any>
}

export interface GeweCallbackResult {
  ok: boolean
  status: 'ignored' | 'bound' | 'routed' | 'error'
  message?: string
  profile?: string
  user_id?: string
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function profileExists(name: string): boolean {
  if (!name || name === 'default') return existsSync(join(HERMES_BASE, 'config.yaml'))
  return existsSync(join(HERMES_BASE, 'profiles', name, 'config.yaml'))
}

function parseBool(value: any, fallback = false): boolean {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase())
  return Boolean(value)
}

function splitCsv(value: any): string[] {
  if (Array.isArray(value)) return value.map(String).map(v => v.trim()).filter(Boolean)
  if (typeof value !== 'string') return []
  return value.split(/[;,\s]+/).map(v => v.trim()).filter(Boolean)
}

function parseEnv(raw: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx < 0) continue
    const key = trimmed.slice(0, eqIdx).trim()
    let value = trimmed.slice(eqIdx + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
  return env
}

async function readProfileGeweConfig(profileDir: string): Promise<Record<string, any>> {
  const result: Record<string, any> = { extra: {} }
  try {
    const raw = await readFile(join(profileDir, 'config.yaml'), 'utf-8')
    const cfg = (YAML.load(raw) as any) || {}
    Object.assign(result, cfg?.platforms?.gewe || {})
    result.extra = { ...(cfg?.platforms?.gewe?.extra || {}) }
  } catch { }
  try {
    const env = parseEnv(await readFile(join(profileDir, '.env'), 'utf-8'))
    if (env.GEWE_TOKEN) result.token = env.GEWE_TOKEN
    if (env.GEWE_APP_ID) result.extra.app_id = env.GEWE_APP_ID
    if (env.GEWE_API_BASE_URL) result.extra.api_base_url = env.GEWE_API_BASE_URL
    if (env.GEWE_CALLBACK_SECRET) result.extra.callback_secret = env.GEWE_CALLBACK_SECRET
    if (env.GEWE_BOT_WXID) result.extra.bot_wxid = env.GEWE_BOT_WXID
    if (env.GEWE_GROUP_POLICY) result.extra.group_policy = env.GEWE_GROUP_POLICY
    if (env.GEWE_GROUP_ALLOWED_CHATS) result.extra.group_allowed_chats = env.GEWE_GROUP_ALLOWED_CHATS
    if (env.GEWE_GROUP_REQUIRE_MENTION) result.extra.group_require_mention = env.GEWE_GROUP_REQUIRE_MENTION
  } catch { }
  return result
}

async function loadOptions(): Promise<GeweOptions> {
  const defaultCfg = await readProfileGeweConfig(getProfileDir('default'))
  const activeDir = getActiveProfileDir()
  const activeCfg: Record<string, any> = activeDir === getProfileDir('default') ? {} : await readProfileGeweConfig(activeDir)
  const merged: Record<string, any> = {
    ...defaultCfg,
    ...activeCfg,
    extra: { ...(defaultCfg.extra || {}), ...((activeCfg as any).extra || {}) },
  }
  const extra = merged.extra || {}
  return {
    token: String(process.env.GEWE_TOKEN || merged.token || extra.token || ''),
    appId: String(process.env.GEWE_APP_ID || extra.app_id || ''),
    apiBaseUrl: String(process.env.GEWE_API_BASE_URL || extra.api_base_url || DEFAULT_API_BASE_URL).replace(/\/+$/, ''),
    callbackSecret: String(process.env.GEWE_CALLBACK_SECRET || extra.callback_secret || ''),
    botWxids: new Set(splitCsv(process.env.GEWE_BOT_WXID || extra.bot_wxid)),
    groupPolicy: String(process.env.GEWE_GROUP_POLICY || extra.group_policy || 'paired').trim().toLowerCase(),
    groupAllowedChats: new Set(splitCsv(process.env.GEWE_GROUP_ALLOWED_CHATS || extra.group_allowed_chats)),
    groupRequireMention: parseBool(process.env.GEWE_GROUP_REQUIRE_MENTION || extra.group_require_mention, false),
  }
}

async function loadStore(): Promise<GeweRouterStore> {
  try {
    const parsed = JSON.parse(await readFile(STORE_PATH, 'utf-8'))
    return {
      bindings: parsed.bindings || {},
      invites: parsed.invites || {},
      processed: parsed.processed || {},
    }
  } catch {
    return { bindings: {}, invites: {}, processed: {} }
  }
}

async function saveStore(store: GeweRouterStore): Promise<void> {
  await mkdir(ROUTER_DIR, { recursive: true })
  const tmp = `${STORE_PATH}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, JSON.stringify(store, null, 2), 'utf-8')
  await rename(tmp, STORE_PATH)
}

function cleanupStore(store: GeweRouterStore): void {
  const now = nowSeconds()
  for (const [code, invite] of Object.entries(store.invites)) {
    if (invite.expires_at <= now) delete store.invites[code]
  }
  for (const [key, seenAt] of Object.entries(store.processed)) {
    if (now - Number(seenAt || 0) > PROCESSED_TTL_SECONDS) delete store.processed[key]
  }
}

function generateInviteCode(): string {
  let code = ''
  for (let i = 0; i < 8; i++) code += INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)]
  return code
}

export async function listGeweBindings(): Promise<{ bindings: GeweBinding[]; invites: GeweInvite[] }> {
  const store = await loadStore()
  cleanupStore(store)
  await saveStore(store)
  return {
    bindings: Object.values(store.bindings).sort((a, b) => a.user_id.localeCompare(b.user_id)),
    invites: Object.values(store.invites).sort((a, b) => b.created_at - a.created_at),
  }
}

export async function upsertGeweBinding(userId: string, profile: string, userName = ''): Promise<GeweBinding> {
  const uid = userId.trim()
  const targetProfile = profile.trim()
  if (!uid) throw new Error('user_id is required')
  if (!targetProfile) throw new Error('profile is required')
  if (!profileExists(targetProfile)) throw new Error(`profile not found: ${targetProfile}`)
  const store = await loadStore()
  const existing = store.bindings[uid]
  const binding: GeweBinding = {
    user_id: uid,
    profile: targetProfile,
    user_name: userName.trim() || existing?.user_name || '',
    bound_at: existing?.bound_at || nowSeconds(),
    updated_at: nowSeconds(),
    source: existing?.source || 'manual',
  }
  store.bindings[uid] = binding
  cleanupStore(store)
  await saveStore(store)
  return binding
}

export async function removeGeweBinding(userId: string): Promise<boolean> {
  const store = await loadStore()
  const existed = Boolean(store.bindings[userId])
  delete store.bindings[userId]
  cleanupStore(store)
  await saveStore(store)
  return existed
}

export async function createGeweInvite(profile: string, label = '', ttlSeconds = DEFAULT_INVITE_TTL_SECONDS): Promise<GeweInvite> {
  const targetProfile = profile.trim()
  if (!targetProfile) throw new Error('profile is required')
  if (!profileExists(targetProfile)) throw new Error(`profile not found: ${targetProfile}`)
  const store = await loadStore()
  cleanupStore(store)
  let code = generateInviteCode()
  while (store.invites[code]) code = generateInviteCode()
  const now = nowSeconds()
  const invite: GeweInvite = {
    code,
    profile: targetProfile,
    label: label.trim(),
    created_at: now,
    expires_at: now + Math.max(60, Math.min(Number(ttlSeconds) || DEFAULT_INVITE_TTL_SECONDS, 86400)),
  }
  store.invites[code] = invite
  await saveStore(store)
  return invite
}

export async function removeGeweInvite(code: string): Promise<boolean> {
  const normalized = code.trim().toUpperCase()
  const store = await loadStore()
  const existed = Boolean(store.invites[normalized])
  delete store.invites[normalized]
  cleanupStore(store)
  await saveStore(store)
  return existed
}

function unwrapRelayPayload(payload: any): Record<string, any> | null {
  if (!payload || typeof payload !== 'object') return null
  if (payload.body && typeof payload.body === 'object') return payload.body
  if (payload.data && typeof payload.data === 'object' && payload.data.body && typeof payload.data.body === 'object') return payload.data.body
  return payload
}

function htmlUnescape(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function tagText(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return htmlUnescape(match?.[1] || '').trim()
}

function extractMentionedUserIds(payload: Record<string, any>): Set<string> {
  const values = new Set<string>()
  for (const key of ['atUserList', 'atuserlist', 'atUsers', 'atWxidList', 'atWxids', 'atUserName', 'mentionedUsers', 'mentionUsers', 'mentionWxids']) {
    for (const item of splitCsv(payload[key])) values.add(item)
  }
  const source = String(payload.msgSource || payload.msgsource || '')
  if (source) {
    for (const item of splitCsv(tagText(htmlUnescape(source), 'atuserlist'))) values.add(item)
  }
  return values
}

function messageText(payload: Record<string, any>, messageType: string): string {
  const content = String(payload.content || payload.text || '')
  if (messageType === 'text') return content.trim()
  if (messageType === 'quote') {
    const title = tagText(content, 'title')
    const quoted = tagText(content, 'content')
    return [`[引用消息] ${title || ''}`.trim(), quoted ? `> ${quoted}` : ''].filter(Boolean).join('\n')
  }
  const labels: Record<string, string> = {
    image: '[图片]',
    voice: '[语音]',
    video: '[视频]',
    file: '[文件]',
    link: '[链接]',
    emoji: '[表情]',
    mini_program: '[小程序]',
    chat_record: '[聊天记录]',
  }
  return labels[messageType] || `[${messageType || '消息'}]`
}

function mapMessageType(value: any): string {
  const raw = String(value || '').toUpperCase()
  return ({
    TEXT: 'text',
    IMAGE: 'image',
    VOICE: 'voice',
    VIDEO: 'video',
    FILE: 'file',
    LINK: 'link',
    QUOTE: 'quote',
    MINI_PROGRAM: 'mini_program',
    CHAT_RECORD: 'chat_record',
    EMOJI: 'emoji',
  } as Record<string, string>)[raw] || raw.toLowerCase() || 'unknown'
}

function normalizeInbound(payload: Record<string, any>): NormalizedGeweInbound | null {
  const fromUser = String(payload.fromUser || '')
  const toUser = String(payload.toUser || '')
  const fromGroup = String(payload.fromGroup || payload.roomWxid || payload.groupId || '')
  if (!fromUser && !toUser) return null
  const eventCode = String(payload.eventCode || '').toLowerCase()
  const conversationType: 'dm' | 'group' = fromGroup || eventCode === 'group_msg_event' ? 'group' : 'dm'
  const messageType = mapMessageType(payload.msgType)
  return {
    accountId: String(payload.wxid || toUser || ''),
    fromUser,
    fromGroup,
    toUser,
    peerId: conversationType === 'group' ? fromGroup : fromUser,
    senderId: fromUser,
    conversationType,
    messageType,
    messageId: String(payload.newMsgId || payload.msgId || payload.id || ''),
    text: messageText(payload, messageType),
    mentionedUserIds: extractMentionedUserIds(payload),
    raw: payload,
  }
}

function shouldProcessGroup(msg: NormalizedGeweInbound, options: GeweOptions): boolean {
  if (options.groupPolicy === 'disabled' || options.groupPolicy === 'off' || options.groupPolicy === 'none') return false
  if (options.groupAllowedChats.size > 0 && !options.groupAllowedChats.has('*') && !options.groupAllowedChats.has(msg.fromGroup)) return false
  if (options.groupPolicy === 'allowlist' && options.groupAllowedChats.size === 0) return false
  if (options.groupRequireMention) {
    for (const botWxid of options.botWxids) {
      if (msg.mentionedUserIds.has(botWxid)) return true
    }
    return false
  }
  return true
}

function extractOutputText(value: any): string {
  const parts: string[] = []
  const visit = (node: any) => {
    if (!node) return
    if (Array.isArray(node)) { node.forEach(visit); return }
    if (typeof node !== 'object') return
    if (typeof node.text === 'string' && ['output_text', 'text'].includes(String(node.type || ''))) parts.push(node.text)
    if (typeof node.output_text === 'string') parts.push(node.output_text)
    if (node.content) visit(node.content)
    if (node.output) visit(node.output)
  }
  visit(value?.output || value)
  return parts.join('').trim()
}

async function sendGeweText(options: GeweOptions, toWxid: string, content: string): Promise<void> {
  const res = await fetch(`${options.apiBaseUrl}/gewe/v2/api/message/postText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-GEWE-TOKEN': options.token },
    body: JSON.stringify({ appId: options.appId, toWxid, content }),
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) throw new Error(`GeWe send failed: ${res.status} ${await res.text()}`)
}

async function callProfileGateway(manager: any, profile: string, msg: NormalizedGeweInbound): Promise<string> {
  const upstream = manager.getUpstream(profile).replace(/\/$/, '')
  const apiKey = manager.getApiKey(profile)
  const sessionKey = msg.conversationType === 'group'
    ? `gewe:group:${msg.fromGroup}:${msg.senderId}`
    : `gewe:dm:${msg.senderId}`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Hermes-Session-Key': sessionKey,
  }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  const res = await fetch(`${upstream}/v1/responses`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      input: msg.text,
      conversation: sessionKey,
      store: true,
    }),
    signal: AbortSignal.timeout(300000),
  })
  const bodyText = await res.text()
  if (!res.ok) throw new Error(`Profile gateway ${profile} failed: ${res.status} ${bodyText}`)
  const data = bodyText ? JSON.parse(bodyText) : {}
  return extractOutputText(data)
}

async function claimInviteIfPresent(store: GeweRouterStore, msg: NormalizedGeweInbound): Promise<GeweBinding | null> {
  if (msg.conversationType !== 'dm') return null
  const match = msg.text.trim().match(/^\/(?:pair|bind)\s+([A-Za-z0-9]+)$/i)
  if (!match) return null
  const code = match[1].toUpperCase()
  const invite = store.invites[code]
  if (!invite || invite.expires_at <= nowSeconds()) return null
  delete store.invites[code]
  const binding: GeweBinding = {
    user_id: msg.senderId,
    profile: invite.profile,
    user_name: invite.label || msg.senderId,
    bound_at: nowSeconds(),
    updated_at: nowSeconds(),
    source: 'invite',
  }
  store.bindings[msg.senderId] = binding
  return binding
}

function checkCallbackSecret(headers: Record<string, any>, options: GeweOptions): boolean {
  if (!options.callbackSecret || options.callbackSecret === 'INSECURE_NO_AUTH') return true
  const supplied = headers['x-hermes-gewe-secret'] || headers['x-gewe-secret'] || headers['X-Hermes-Gewe-Secret'] || headers['X-Gewe-Secret']
  return String(supplied || '') === options.callbackSecret
}

export async function handleGeweCallback(payload: any, headers: Record<string, any>, manager: any): Promise<GeweCallbackResult> {
  const options = await loadOptions()
  if (!checkCallbackSecret(headers, options)) {
    return { ok: false, status: 'error', message: 'invalid callback secret' }
  }
  if (!options.token || !options.appId || options.botWxids.size === 0) {
    return { ok: false, status: 'error', message: 'GEWE_TOKEN, GEWE_APP_ID and GEWE_BOT_WXID are required' }
  }
  const body = unwrapRelayPayload(payload)
  if (!body) return { ok: false, status: 'error', message: 'invalid payload' }
  if (parseBool(body.isSelf, false)) return { ok: true, status: 'ignored', message: 'self message' }
  const msg = normalizeInbound(body)
  if (!msg || !msg.senderId || !msg.peerId) return { ok: true, status: 'ignored', message: 'unsupported message' }

  const store = await loadStore()
  cleanupStore(store)
  const processedKey = msg.messageId ? `${msg.accountId}:${msg.messageId}` : ''
  if (processedKey && store.processed[processedKey]) {
    await saveStore(store)
    return { ok: true, status: 'ignored', message: 'duplicate message' }
  }
  if (processedKey) store.processed[processedKey] = nowSeconds()

  const claimed = await claimInviteIfPresent(store, msg)
  if (claimed) {
    await saveStore(store)
    await sendGeweText(options, msg.senderId, `绑定成功，后续消息将由 profile「${claimed.profile}」处理。`)
    return { ok: true, status: 'bound', profile: claimed.profile, user_id: msg.senderId }
  }

  if (msg.conversationType === 'group' && !shouldProcessGroup(msg, options)) {
    await saveStore(store)
    return { ok: true, status: 'ignored', message: 'group policy skipped' }
  }

  const binding = store.bindings[msg.senderId]
  if (!binding) {
    await saveStore(store)
    return { ok: true, status: 'ignored', message: 'sender is not bound', user_id: msg.senderId }
  }
  if (!profileExists(binding.profile)) {
    await saveStore(store)
    return { ok: false, status: 'error', message: `bound profile not found: ${binding.profile}`, profile: binding.profile, user_id: msg.senderId }
  }
  await saveStore(store)

  logger.info('[gewe-router] routing sender=%s chat=%s profile=%s', msg.senderId, msg.peerId, binding.profile)
  const reply = await callProfileGateway(manager, binding.profile, msg)
  if (reply) await sendGeweText(options, msg.peerId, reply)
  return { ok: true, status: 'routed', profile: binding.profile, user_id: msg.senderId }
}
