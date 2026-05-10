import { existsSync } from 'fs'
import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { dirname, join, resolve } from 'path'
import YAML from 'js-yaml'

const HERMES_BASE = process.env.HERMES_HOME || resolve(homedir(), '.hermes')
const ROUTER_DIR = join(HERMES_BASE, 'platforms', 'gewe')
const STORE_PATH = join(ROUTER_DIR, 'bindings.json')
const PAIRING_DIR = join(HERMES_BASE, 'platforms', 'pairing')
const PAIRING_PENDING_PATH = join(PAIRING_DIR, 'gewe-pending.json')
const PAIRING_APPROVED_PATH = join(PAIRING_DIR, 'gewe-approved.json')
const DEFAULT_API_BASE_URL = 'https://api.geweapi.com'
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
  source?: 'manual'
}


export interface GewePairingUser {
  identity: string
  user_id: string
  user_name?: string
  status: 'pending' | 'approved' | 'bound'
  code?: string
  created_at?: number
  approved_at?: number
  profile?: string
  bound_at?: number
}

interface GeweRouterStore {
  bindings: Record<string, GeweBinding>
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
      processed: parsed.processed || {},
    }
  } catch {
    return { bindings: {}, processed: {} }
  }
}

async function saveStore(store: GeweRouterStore): Promise<void> {
  await mkdir(ROUTER_DIR, { recursive: true })
  const tmp = `${STORE_PATH}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, JSON.stringify(store, null, 2), 'utf-8')
  await rename(tmp, STORE_PATH)
}

async function loadJsonRecord(path: string): Promise<Record<string, any>> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf-8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

async function saveJsonRecord(path: string, data: Record<string, any>): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8')
  await rename(tmp, path)
}

async function approveGewePairingUser(identity: string, name = ''): Promise<void> {
  const userId = identity.trim()
  if (!userId) return
  const [pending, approved] = await Promise.all([
    loadJsonRecord(PAIRING_PENDING_PATH),
    loadJsonRecord(PAIRING_APPROVED_PATH),
  ])
  let userName = name.trim()
  let changedPending = false
  for (const [code, entry] of Object.entries(pending)) {
    if (!entry || typeof entry !== 'object') continue
    if (String((entry as any).user_id || '') !== userId) continue
    userName ||= String((entry as any).user_name || '')
    delete pending[code]
    changedPending = true
  }
  approved[userId] = {
    user_name: userName || String(approved[userId]?.user_name || ''),
    approved_at: Number(approved[userId]?.approved_at || 0) || Date.now() / 1000,
  }
  if (changedPending) await saveJsonRecord(PAIRING_PENDING_PATH, pending)
  await saveJsonRecord(PAIRING_APPROVED_PATH, approved)
}

function cleanupStore(store: GeweRouterStore): void {
  const now = nowSeconds()
  for (const [key, seenAt] of Object.entries(store.processed)) {
    if (now - Number(seenAt || 0) > PROCESSED_TTL_SECONDS) delete store.processed[key]
  }
}

export async function listGeweBindings(): Promise<{ bindings: GeweBinding[] }> {
  const store = await loadStore()
  cleanupStore(store)
  await saveStore(store)
  return {
    bindings: Object.values(store.bindings).map(normalizeBinding).sort((a, b) => `${a.type}:${a.identity}`.localeCompare(`${b.type}:${b.identity}`)),
  }
}

export async function listGewePairingUsers(): Promise<GewePairingUser[]> {
  const [pending, approved, routerStore] = await Promise.all([
    loadJsonRecord(PAIRING_PENDING_PATH),
    loadJsonRecord(PAIRING_APPROVED_PATH),
    loadStore(),
  ])
  const users = new Map<string, GewePairingUser>()

  for (const [code, entry] of Object.entries(pending)) {
    if (!entry || typeof entry !== 'object' || (entry as any).invite) continue
    const identity = String((entry as any).user_id || '').trim()
    if (!identity) continue
    users.set(identity, {
      identity,
      user_id: identity,
      user_name: String((entry as any).user_name || ''),
      status: 'pending',
      code,
      created_at: Number((entry as any).created_at || 0) || undefined,
    })
  }

  for (const [identity, entry] of Object.entries(approved)) {
    const userId = String(identity || '').trim()
    if (!userId) continue
    users.set(userId, {
      ...users.get(userId),
      identity: userId,
      user_id: userId,
      user_name: String((entry as any)?.user_name || users.get(userId)?.user_name || ''),
      status: 'approved',
      approved_at: Number((entry as any)?.approved_at || 0) || undefined,
    })
  }

  for (const rawBinding of Object.values(routerStore.bindings)) {
    const binding = normalizeBinding(rawBinding)
    if (binding.type !== 'user' || !binding.identity) continue
    users.set(binding.identity, {
      ...users.get(binding.identity),
      identity: binding.identity,
      user_id: binding.identity,
      user_name: binding.name || binding.user_name || users.get(binding.identity)?.user_name || '',
      status: 'bound',
      profile: binding.profile,
      bound_at: binding.bound_at,
    })
  }

  const rank = { pending: 0, approved: 1, bound: 2 } as const
  return Array.from(users.values()).sort((a, b) => {
    const byStatus = rank[a.status] - rank[b.status]
    if (byStatus) return byStatus
    return a.identity.localeCompare(b.identity)
  })
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
  if (targetType === 'user') await approveGewePairingUser(uid, binding.name || binding.user_name || '')
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
