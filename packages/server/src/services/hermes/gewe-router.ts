import { randomInt } from 'crypto'
import { existsSync } from 'fs'
import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { dirname, join, resolve } from 'path'
import YAML from 'js-yaml'

const HERMES_BASE = process.env.HERMES_HOME || resolve(homedir(), '.hermes')
const ROUTER_DIR = join(HERMES_BASE, 'platforms', 'gewe')
const STORE_PATH = join(ROUTER_DIR, 'bindings.json')
const DEFAULT_API_BASE_URL = 'https://api.geweapi.com'
const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const DEFAULT_INVITE_TTL_SECONDS = 3600
const PROCESSED_TTL_SECONDS = 600

export interface GeweBinding {
  type: 'user' | 'group'
  identity: string
  user_id: string
  profile: string
  name?: string
  user_name?: string
  listen_all?: boolean
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

export interface GewePageConfig {
  common: Record<string, any>
  profile: Record<string, any>
}

const COMMON_ENV_MAP: Record<string, string> = {
  enabled: 'GEWE_ENABLED',
  token: 'GEWE_TOKEN',
  app_id: 'GEWE_APP_ID',
  api_base_url: 'GEWE_API_BASE_URL',
  callback_host: 'GEWE_CALLBACK_HOST',
  callback_port: 'GEWE_CALLBACK_PORT',
  callback_path: 'GEWE_CALLBACK_PATH',
  callback_secret: 'GEWE_CALLBACK_SECRET',
  bot_wxid: 'GEWE_BOT_WXID',
  inbound_mode: 'GEWE_INBOUND_MODE',
  relay_base_url: 'GEWE_RELAY_BASE_URL',
  relay_app_id: 'GEWE_RELAY_APP_ID',
  relay_app_token: 'GEWE_RELAY_APP_TOKEN',
  relay_channel: 'GEWE_RELAY_CHANNEL',
  relay_sse_url: 'GEWE_RELAY_SSE_URL',
  group_policy: 'GEWE_GROUP_POLICY',
  group_allowed_chats: 'GEWE_GROUP_ALLOWED_CHATS',
  group_require_mention: 'GEWE_GROUP_REQUIRE_MENTION',
  profile_routing_mode: 'GEWE_PROFILE_ROUTING_MODE',
  profile_router_store: 'GEWE_PROFILE_ROUTER_STORE',
}

const PROFILE_ENV_MAP: Record<string, string> = {
  home_channel: 'GEWE_HOME_CHANNEL',
  home_channel_name: 'GEWE_HOME_CHANNEL_NAME',
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
    if (env.GEWE_ENABLED) result.enabled = parseBool(env.GEWE_ENABLED, false)
    if (env.GEWE_TOKEN) result.token = env.GEWE_TOKEN
    if (env.GEWE_APP_ID) result.extra.app_id = env.GEWE_APP_ID
    if (env.GEWE_API_BASE_URL) result.extra.api_base_url = env.GEWE_API_BASE_URL
    if (env.GEWE_CALLBACK_HOST) result.extra.callback_host = env.GEWE_CALLBACK_HOST
    if (env.GEWE_CALLBACK_PORT) result.extra.callback_port = env.GEWE_CALLBACK_PORT
    if (env.GEWE_CALLBACK_PATH) result.extra.callback_path = env.GEWE_CALLBACK_PATH
    if (env.GEWE_CALLBACK_SECRET) result.extra.callback_secret = env.GEWE_CALLBACK_SECRET
    if (env.GEWE_BOT_WXID) result.extra.bot_wxid = env.GEWE_BOT_WXID
    if (env.GEWE_INBOUND_MODE) result.extra.inbound_mode = env.GEWE_INBOUND_MODE
    if (env.GEWE_RELAY_BASE_URL) result.extra.relay_base_url = env.GEWE_RELAY_BASE_URL
    if (env.GEWE_RELAY_APP_ID) result.extra.relay_app_id = env.GEWE_RELAY_APP_ID
    if (env.GEWE_RELAY_APP_TOKEN) result.extra.relay_app_token = env.GEWE_RELAY_APP_TOKEN
    if (env.GEWE_RELAY_CHANNEL) result.extra.relay_channel = env.GEWE_RELAY_CHANNEL
    if (env.GEWE_RELAY_SSE_URL) result.extra.relay_sse_url = env.GEWE_RELAY_SSE_URL
    if (env.GEWE_GROUP_POLICY) result.extra.group_policy = env.GEWE_GROUP_POLICY
    if (env.GEWE_GROUP_ALLOWED_CHATS) result.extra.group_allowed_chats = env.GEWE_GROUP_ALLOWED_CHATS
    if (env.GEWE_GROUP_REQUIRE_MENTION) result.extra.group_require_mention = env.GEWE_GROUP_REQUIRE_MENTION
    if (env.GEWE_PROFILE_ROUTING_MODE) result.extra.profile_routing_mode = env.GEWE_PROFILE_ROUTING_MODE
    if (env.GEWE_PROFILE_ROUTER_STORE) result.extra.profile_router_store = env.GEWE_PROFILE_ROUTER_STORE
    if (env.GEWE_HOME_CHANNEL) result.extra.home_channel = env.GEWE_HOME_CHANNEL
    if (env.GEWE_HOME_CHANNEL_NAME) result.extra.home_channel_name = env.GEWE_HOME_CHANNEL_NAME
  } catch { }
  return result
}

function flattenCommonConfig(cfg: Record<string, any>): Record<string, any> {
  const extra = cfg.extra || {}
  return {
    enabled: parseBool(cfg.enabled, false),
    token: String(cfg.token || ''),
    app_id: String(extra.app_id || ''),
    api_base_url: String(extra.api_base_url || DEFAULT_API_BASE_URL),
    callback_host: String(extra.callback_host || '0.0.0.0'),
    callback_port: String(extra.callback_port || '8656'),
    callback_path: String(extra.callback_path || ''),
    callback_secret: String(extra.callback_secret || ''),
    bot_wxid: String(extra.bot_wxid || ''),
    inbound_mode: String(extra.inbound_mode || 'direct-callback'),
    relay_base_url: String(extra.relay_base_url || 'https://hook.yunzxu.com'),
    relay_app_id: String(extra.relay_app_id || ''),
    relay_app_token: String(extra.relay_app_token || ''),
    relay_channel: String(extra.relay_channel || ''),
    relay_sse_url: String(extra.relay_sse_url || ''),
    group_policy: String(extra.group_policy || 'paired'),
    group_allowed_chats: String(extra.group_allowed_chats || ''),
    group_require_mention: parseBool(extra.group_require_mention, false),
    profile_routing_mode: String(extra.profile_routing_mode || 'standalone'),
    profile_router_store: String(extra.profile_router_store || ''),
  }
}

function flattenProfileConfig(cfg: Record<string, any>): Record<string, any> {
  const extra = cfg.extra || {}
  return {
    home_channel: String(extra.home_channel || ''),
    home_channel_name: String(extra.home_channel_name || 'Home'),
  }
}

async function saveEnvValueAtPath(envPath: string, key: string, value: string): Promise<void> {
  let raw = ''
  try { raw = await readFile(envPath, 'utf-8') } catch { }
  const remove = value === ''
  const lines = raw.split('\n')
  let found = false
  const result: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx !== -1 && trimmed.slice(0, eqIdx).trim() === key) {
      if (!remove) result.push(`${key}=${value}`)
      found = true
    } else if (trimmed.startsWith(`# ${key}=`)) {
      if (!remove) result.push(`${key}=${value}`)
      found = true
    } else {
      result.push(line)
    }
  }
  if (!found && !remove) result.push(`${key}=${value}`)
  const output = result.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '') + '\n'
  await mkdir(dirname(envPath), { recursive: true })
  await writeFile(envPath, output, 'utf-8')
}

function profileDirForWrite(profile: string): string {
  if (!profile || profile === 'default') return HERMES_BASE
  return join(HERMES_BASE, 'profiles', profile)
}

export async function getGewePageConfig(profile: string): Promise<GewePageConfig> {
  const targetProfile = profile || 'default'
  if (!profileExists(targetProfile)) throw new Error(`profile not found: ${targetProfile}`)
  const common = flattenCommonConfig(await readProfileGeweConfig(profileDirForWrite('default')))
  const profileCfg = flattenProfileConfig(await readProfileGeweConfig(profileDirForWrite(targetProfile)))
  return { common, profile: profileCfg }
}

export async function saveGeweCommonConfig(values: Record<string, any>): Promise<Record<string, any>> {
  const envPath = join(profileDirForWrite('default'), '.env')
  for (const [key, envKey] of Object.entries(COMMON_ENV_MAP)) {
    if (!(key in values)) continue
    const value = typeof values[key] === 'boolean' ? String(values[key]) : String(values[key] ?? '').trim()
    await saveEnvValueAtPath(envPath, envKey, value)
  }
  return flattenCommonConfig(await readProfileGeweConfig(profileDirForWrite('default')))
}

export async function saveGeweProfileConfig(profile: string, values: Record<string, any>): Promise<Record<string, any>> {
  const targetProfile = profile || 'default'
  if (!profileExists(targetProfile)) throw new Error(`profile not found: ${targetProfile}`)
  const envPath = join(profileDirForWrite(targetProfile), '.env')
  for (const [key, envKey] of Object.entries(PROFILE_ENV_MAP)) {
    if (!(key in values)) continue
    await saveEnvValueAtPath(envPath, envKey, String(values[key] ?? '').trim())
  }
  return flattenProfileConfig(await readProfileGeweConfig(profileDirForWrite(targetProfile)))
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
    bindings: Object.values(store.bindings).map(normalizeBinding).sort((a, b) => `${a.type}:${a.identity}`.localeCompare(`${b.type}:${b.identity}`)),
    invites: Object.values(store.invites).sort((a, b) => b.created_at - a.created_at),
  }
}

function bindingKey(type: 'user' | 'group', identity: string): string {
  return `${type}:${identity}`
}

function normalizeBinding(binding: GeweBinding): GeweBinding {
  const type = binding.type || 'user'
  const identity = binding.identity || binding.user_id
  const name = binding.name || binding.user_name || ''
  return {
    ...binding,
    type,
    identity,
    user_id: identity,
    name,
    user_name: name,
    listen_all: type === 'group' ? !!binding.listen_all : false,
  }
}

export async function upsertGeweBinding(identity: string, profile: string, name = '', type: 'user' | 'group' = 'user', listenAll = false): Promise<GeweBinding> {
  const targetType = type === 'group' ? 'group' : 'user'
  const uid = identity.trim()
  const targetProfile = profile.trim()
  if (!uid) throw new Error('user_id is required')
  if (!targetProfile) throw new Error('profile is required')
  if (!profileExists(targetProfile)) throw new Error(`profile not found: ${targetProfile}`)
  const store = await loadStore()
  const key = bindingKey(targetType, uid)
  const existing = store.bindings[key] || store.bindings[uid]
  const binding: GeweBinding = {
    type: targetType,
    identity: uid,
    user_id: uid,
    profile: targetProfile,
    name: name.trim() || existing?.name || existing?.user_name || '',
    user_name: name.trim() || existing?.user_name || existing?.name || '',
    listen_all: targetType === 'group' ? !!listenAll : false,
    bound_at: existing?.bound_at || nowSeconds(),
    updated_at: nowSeconds(),
    source: existing?.source || 'manual',
  }
  delete store.bindings[uid]
  store.bindings[key] = binding
  cleanupStore(store)
  await saveStore(store)
  return binding
}

export async function removeGeweBinding(identity: string, type: 'user' | 'group' = 'user'): Promise<boolean> {
  const store = await loadStore()
  const key = bindingKey(type === 'group' ? 'group' : 'user', identity)
  const existed = Boolean(store.bindings[key] || store.bindings[identity])
  delete store.bindings[key]
  delete store.bindings[identity]
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
