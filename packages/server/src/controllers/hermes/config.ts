import { readFile, writeFile, copyFile, readdir } from 'fs/promises'
import YAML from 'js-yaml'
import { restartGateway } from '../../services/hermes/hermes-cli'
import { getActiveConfigPath, getActiveEnvPath, getActiveProfileName, getProfileDir } from '../../services/hermes/hermes-profile'
import { saveEnvValue } from '../../services/config-helpers'

const PLATFORM_SECTIONS = new Set([
  'telegram', 'discord', 'slack', 'whatsapp', 'matrix',
  'weixin', 'gewe', 'wecom', 'feishu', 'dingtalk',
  'platforms',
  'approvals',
])

const configPath = () => getActiveConfigPath()
const envPath = () => getActiveEnvPath()

function parseBool(value: any, fallback = false): boolean {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase())
  return Boolean(value)
}

function profileConfigPath(profile: string): string {
  return `${getProfileDir(profile)}/config.yaml`
}

function profileEnvPath(profile: string): string {
  return `${getProfileDir(profile)}/.env`
}

async function listProfiles(): Promise<string[]> {
  const names = new Set<string>()
  try { await readFile(profileConfigPath('default'), 'utf-8'); names.add('default') } catch { }
  try {
    const base = getProfileDir('default')
    const entries = await readdir(`${base}/profiles`, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      try { await readFile(profileConfigPath(entry.name), 'utf-8'); names.add(entry.name) } catch { }
    }
  } catch { }
  return Array.from(names)
}

async function readProfileGeweConfig(profile: string): Promise<Record<string, any>> {
  const result: Record<string, any> = { extra: {} }
  try {
    const raw = await readFile(profileConfigPath(profile), 'utf-8')
    const cfg = (YAML.load(raw) as any) || {}
    Object.assign(result, cfg?.platforms?.gewe || {})
    result.extra = { ...(cfg?.platforms?.gewe?.extra || {}) }
  } catch { }
  try {
    const env = parseEnv(await readFile(profileEnvPath(profile), 'utf-8'))
    for (const [envKey, [platform, cfgPath]] of Object.entries(envPlatformMap)) {
      if (platform !== 'gewe') continue
      const val = env[envKey]
      if (val === undefined || val === '') continue
      let finalVal: any = val
      if (booleanEnvVars.has(envKey)) finalVal = parseBool(val, false)
      setNested(result, cfgPath, finalVal)
    }
  } catch { }
  return result
}

function flattenGeweConfig(config: Record<string, any>): Record<string, any> {
  const extra = config.extra || {}
  return {
    enabled: parseBool(config.enabled, false),
    token: String(config.token || ''),
    app_id: String(extra.app_id || ''),
    inbound_mode: String(extra.inbound_mode || 'direct-callback'),
    relay_app_id: String(extra.relay_app_id || ''),
    relay_app_token: String(extra.relay_app_token || ''),
  }
}

function flattenCredentialValues(values: Record<string, any>): Record<string, any> {
  const flatValues: Record<string, any> = {}
  for (const [key, val] of Object.entries(values)) {
    if (key === 'extra' && val && typeof val === 'object') {
      for (const [subKey, subVal] of Object.entries(val as Record<string, any>)) flatValues[`extra.${subKey}`] = subVal
    } else flatValues[key] = val
  }
  return flatValues
}

function proposedGeweConfig(current: Record<string, any>, flatValues: Record<string, any>): Record<string, any> {
  const next = structuredClone(current)
  for (const [cfgPath, val] of Object.entries(flatValues)) {
    if (!(cfgPath in (platformEnvMap.gewe || {}))) continue
    setNested(next, cfgPath, val)
  }
  return flattenGeweConfig(next)
}

function duplicateProfile(all: Array<{ profile: string; config: Record<string, any> }>, target: string, field: string, value: string): string | null {
  const needle = value.trim()
  if (!needle) return null
  const duplicate = all.find(item => item.profile !== target && String(item.config[field] || '').trim() === needle)
  return duplicate?.profile || null
}

async function assertUniqueGeweCredentials(flatValues: Record<string, any>): Promise<void> {
  const targetProfile = getActiveProfileName()
  const current = await readProfileGeweConfig(targetProfile)
  const proposed = proposedGeweConfig(current, flatValues)
  const all = await Promise.all((await listProfiles()).map(async profile => ({
    profile,
    config: flattenGeweConfig(await readProfileGeweConfig(profile)),
  })))

  const appIdOwner = duplicateProfile(all, targetProfile, 'app_id', proposed.app_id)
  if (appIdOwner) throw new Error(`GeWe App ID is already used by profile "${appIdOwner}"`)

  const tokenOwner = duplicateProfile(all, targetProfile, 'token', proposed.token)
  if (tokenOwner) throw new Error(`GeWe Token is already used by profile "${tokenOwner}"`)

  if (!['relay-callback', 'relay-sse'].includes(proposed.inbound_mode)) return

  const relayAppIdOwner = duplicateProfile(all, targetProfile, 'relay_app_id', proposed.relay_app_id)
  if (relayAppIdOwner) throw new Error(`Webhook-router App ID is already used by profile "${relayAppIdOwner}"`)

  const relayTokenOwner = duplicateProfile(all, targetProfile, 'relay_app_token', proposed.relay_app_token)
  if (relayTokenOwner) throw new Error(`Webhook-router token is already used by profile "${relayTokenOwner}"`)
}

const envPlatformMap: Record<string, [string, string]> = {
  TELEGRAM_BOT_TOKEN: ['telegram', 'token'],
  DISCORD_BOT_TOKEN: ['discord', 'token'],
  SLACK_BOT_TOKEN: ['slack', 'token'],
  MATRIX_ACCESS_TOKEN: ['matrix', 'token'],
  MATRIX_HOMESERVER: ['matrix', 'extra.homeserver'],
  FEISHU_APP_ID: ['feishu', 'extra.app_id'],
  FEISHU_APP_SECRET: ['feishu', 'extra.app_secret'],
  DINGTALK_CLIENT_ID: ['dingtalk', 'extra.client_id'],
  DINGTALK_CLIENT_SECRET: ['dingtalk', 'extra.client_secret'],
  DINGTALK_APP_KEY: ['dingtalk', 'extra.app_key'],
  WECOM_BOT_ID: ['wecom', 'extra.bot_id'],
  WECOM_SECRET: ['wecom', 'extra.secret'],
  WEIXIN_TOKEN: ['weixin', 'token'],
  WEIXIN_ACCOUNT_ID: ['weixin', 'extra.account_id'],
  WEIXIN_BASE_URL: ['weixin', 'extra.base_url'],
  GEWE_TOKEN: ['gewe', 'token'],
  GEWE_ENABLED: ['gewe', 'enabled'],
  GEWE_APP_ID: ['gewe', 'extra.app_id'],
  GEWE_API_BASE_URL: ['gewe', 'extra.api_base_url'],
  GEWE_INBOUND_MODE: ['gewe', 'extra.inbound_mode'],
  GEWE_CALLBACK_HOST: ['gewe', 'extra.callback_host'],
  GEWE_CALLBACK_PORT: ['gewe', 'extra.callback_port'],
  GEWE_CALLBACK_PATH: ['gewe', 'extra.callback_path'],
  GEWE_CALLBACK_SECRET: ['gewe', 'extra.callback_secret'],
  GEWE_RELAY_BASE_URL: ['gewe', 'extra.relay_base_url'],
  GEWE_RELAY_APP_ID: ['gewe', 'extra.relay_app_id'],
  GEWE_RELAY_APP_TOKEN: ['gewe', 'extra.relay_app_token'],
  GEWE_RELAY_CHANNEL: ['gewe', 'extra.relay_channel'],
  GEWE_RELAY_SSE_URL: ['gewe', 'extra.relay_sse_url'],
  GEWE_ALLOWED_USERS: ['gewe', 'extra.allowed_users'],
  GEWE_ALLOW_ALL_USERS: ['gewe', 'extra.allow_all_users'],
  GEWE_UNAUTHORIZED_DM_BEHAVIOR: ['gewe', 'extra.unauthorized_dm_behavior'],
  GEWE_DOWNLOAD_MEDIA: ['gewe', 'extra.download_media'],
  GEWE_HOME_CHANNEL: ['gewe', 'extra.home_channel'],
  GEWE_HOME_CHANNEL_NAME: ['gewe', 'extra.home_channel_name'],
  GEWE_GROUP_POLICY: ['gewe', 'extra.group_policy'],
  GEWE_GROUP_ALLOWED_CHATS: ['gewe', 'extra.group_allowed_chats'],
  GEWE_GROUP_REQUIRE_MENTION: ['gewe', 'extra.group_require_mention'],
  GEWE_BOT_WXID: ['gewe', 'extra.bot_wxid'],
  WHATSAPP_ENABLED: ['whatsapp', 'enabled'],
}

const platformEnvMap: Record<string, Record<string, string>> = {}
for (const [envVar, [platform, cfgPath]] of Object.entries(envPlatformMap)) {
  if (!platformEnvMap[platform]) platformEnvMap[platform] = {}
  platformEnvMap[platform][cfgPath] = envVar
}

const booleanEnvVars = new Set([
  'GEWE_ENABLED',
  'GEWE_ALLOW_ALL_USERS',
  'GEWE_DOWNLOAD_MEDIA',
  'GEWE_GROUP_REQUIRE_MENTION',
  'WHATSAPP_ENABLED',
])

const defaultPlatforms: Record<string, any> = {
  gewe: {
    enabled: false,
    extra: {
      api_base_url: 'https://api.geweapi.com',
      inbound_mode: 'direct-callback',
      callback_host: '0.0.0.0',
      callback_port: '8656',
      callback_path: '/gewe/callback',
      relay_base_url: 'https://hook.yunzxu.com',
      allow_all_users: false,
      unauthorized_dm_behavior: 'pair',
      download_media: true,
      home_channel_name: 'Home',
      group_policy: 'paired',
      group_require_mention: false,
    },
  },
}

function parseEnv(raw: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed.slice(eqIdx + 1).trim()
    if (val) env[key] = val
  }
  return env
}

function setNested(obj: Record<string, any>, path: string, value: any) {
  const parts = path.split('.')
  let cur = obj
  for (let i = 0; i < parts.length - 1; i++) { if (!cur[parts[i]]) cur[parts[i]] = {}; cur = cur[parts[i]] }
  cur[parts[parts.length - 1]] = value
}

function deepMerge(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) &&
        target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
      target[key] = deepMerge(target[key], source[key])
    } else {
      target[key] = source[key]
    }
  }
  return target
}

async function readEnvPlatforms(): Promise<Record<string, any>> {
  try {
    const raw = await readFile(envPath(), 'utf-8')
    const env = parseEnv(raw)
    const platforms: Record<string, any> = {}
    for (const [envKey, [platform, cfgPath]] of Object.entries(envPlatformMap)) {
      const val = env[envKey]
      if (val === undefined || val === '') continue
      if (!platforms[platform]) platforms[platform] = {}
      let finalVal: any = val
      if (booleanEnvVars.has(envKey)) finalVal = ['true', '1', 'yes', 'on'].includes(val.toLowerCase())
      setNested(platforms[platform], cfgPath, finalVal)
    }
    return platforms
  } catch { return {} }
}

async function readConfig(): Promise<Record<string, any>> {
  const raw = await readFile(configPath(), 'utf-8')
  return (YAML.load(raw) as Record<string, any>) || {}
}

async function writeConfig(data: Record<string, any>): Promise<void> {
  const cp = configPath()
  await copyFile(cp, cp + '.bak')
  const yamlStr = YAML.dump(data, {
    lineWidth: -1,
    noRefs: true,
    quotingType: '"',
    forceQuotes: true, // Force quotes on all string values
  })
  await writeFile(cp, yamlStr, 'utf-8')
}

export async function getConfig(ctx: any) {
  try {
    const config = await readConfig()
    config.platforms = deepMerge(structuredClone(defaultPlatforms), config.platforms || {})
    const envPlatforms = await readEnvPlatforms()
    if (Object.keys(envPlatforms).length > 0) {
      const existing = config.platforms || {}
      for (const [platform, vals] of Object.entries(envPlatforms)) {
        existing[platform] = deepMerge({ ...(existing[platform] || {}) }, vals as Record<string, any>)
      }
      config.platforms = existing
    }
    const { section, sections } = ctx.query
    if (section) {
      ctx.body = { [section as string]: config[section as string] || {} }
    } else if (sections) {
      const keys = (sections as string).split(',')
      const result: Record<string, any> = {}
      for (const key of keys) { result[key.trim()] = config[key.trim()] || {} }
      ctx.body = result
    } else {
      ctx.body = config
    }
  } catch (err: any) {
    ctx.status = 500; ctx.body = { error: err.message }
  }
}

export async function updateConfig(ctx: any) {
  const { section, values } = ctx.request.body as { section: string; values: Record<string, any> }
  if (!section || !values) {
    ctx.status = 400; ctx.body = { error: 'Missing section or values' }; return
  }
  try {
    const config = await readConfig()
    config[section] = deepMerge(config[section] || {}, values)
    await writeConfig(config)
    if (PLATFORM_SECTIONS.has(section)) { await restartGateway() }
    ctx.body = { success: true }
  } catch (err: any) {
    ctx.status = 500; ctx.body = { error: err.message }
  }
}

export async function updateCredentials(ctx: any) {
  const { platform, values } = ctx.request.body as { platform: string; values: Record<string, any> }
  if (!platform || !values) {
    ctx.status = 400; ctx.body = { error: 'Missing platform or values' }; return
  }
  try {
    const envMap = platformEnvMap[platform]
    if (!envMap) {
      ctx.status = 400; ctx.body = { error: `Unknown platform: ${platform}` }; return
    }
    const config = await readConfig()
    let configChanged = false
    const flatValues = flattenCredentialValues(values)
    if (platform === 'gewe') await assertUniqueGeweCredentials(flatValues)
    for (const [cfgPath, val] of Object.entries(flatValues)) {
      const envVar = envMap[cfgPath]
      if (!envVar) continue
      if (val === undefined || val === null || val === '') {
        await saveEnvValue(envVar, '')
        const parts = cfgPath.split('.')
        let obj: any = config.platforms?.[platform]
        if (obj) {
          if (parts.length === 1) { delete obj[parts[0]] }
          else {
            let cur = obj
            for (let i = 0; i < parts.length - 1; i++) { if (!cur[parts[i]]) break; cur = cur[parts[i]] }
            delete cur[parts[parts.length - 1]]
            if (obj.extra && Object.keys(obj.extra).length === 0) delete obj.extra
          }
          if (Object.keys(obj).length === 0) { if (!config.platforms) config.platforms = {}; delete config.platforms[platform] }
          configChanged = true
        }
      } else {
        await saveEnvValue(envVar, String(val))
      }
    }
    if (configChanged) { await writeConfig(config) }
    await restartGateway()
    ctx.body = { success: true }
  } catch (err: any) {
    ctx.status = 500; ctx.body = { error: err.message }
  }
}
