import type { Context } from 'koa'
import {
  createGeweInvite,
  getGewePageConfig,
  listGeweBindings,
  removeGeweBinding,
  removeGeweInvite,
  saveGeweCommonConfig,
  saveGeweProfileConfig,
  upsertGeweBinding,
} from '../../services/hermes/gewe-router'

export async function list(ctx: Context) {
  ctx.body = await listGeweBindings()
}

export async function config(ctx: Context) {
  const profile = String(ctx.query.profile || 'default')
  try {
    ctx.body = await getGewePageConfig(profile)
  } catch (err: any) {
    ctx.status = 400
    ctx.body = { ok: false, error: err?.message || 'failed to load GeWe config' }
  }
}

export async function updateCommonConfig(ctx: Context) {
  const body = ctx.request.body as { values?: Record<string, any> }
  try {
    const common = await saveGeweCommonConfig(body.values || {})
    ctx.body = { ok: true, common }
  } catch (err: any) {
    ctx.status = 400
    ctx.body = { ok: false, error: err?.message || 'failed to save GeWe common config' }
  }
}

export async function updateProfileConfig(ctx: Context) {
  const body = ctx.request.body as { values?: Record<string, any> }
  const profile = String(ctx.params.profile || 'default')
  try {
    const profileConfig = await saveGeweProfileConfig(profile, body.values || {})
    ctx.body = { ok: true, profile: profileConfig }
  } catch (err: any) {
    ctx.status = 400
    ctx.body = { ok: false, error: err?.message || 'failed to save GeWe profile config' }
  }
}

export async function bind(ctx: Context) {
  const body = ctx.request.body as { user_id?: string; identity?: string; profile?: string; user_name?: string; name?: string; type?: 'user' | 'group'; listen_all?: boolean }
  try {
    const binding = await upsertGeweBinding(
      body.identity || body.user_id || '',
      body.profile || '',
      body.name || body.user_name || '',
      body.type || 'user',
      !!body.listen_all,
    )
    ctx.body = { ok: true, binding }
  } catch (err: any) {
    ctx.status = 400
    ctx.body = { ok: false, error: err?.message || 'failed to bind user' }
  }
}

export async function unbind(ctx: Context) {
  const userId = String(ctx.params.userId || '')
  const type = String(ctx.query.type || 'user') === 'group' ? 'group' : 'user'
  ctx.body = { ok: true, removed: await removeGeweBinding(userId, type) }
}

export async function invite(ctx: Context) {
  const body = ctx.request.body as { profile?: string; label?: string; ttl_seconds?: number }
  try {
    const invite = await createGeweInvite(body.profile || '', body.label || '', body.ttl_seconds)
    ctx.body = { ok: true, invite }
  } catch (err: any) {
    ctx.status = 400
    ctx.body = { ok: false, error: err?.message || 'failed to create invite' }
  }
}

export async function deleteInvite(ctx: Context) {
  const code = String(ctx.params.code || '')
  ctx.body = { ok: true, removed: await removeGeweInvite(code) }
}
