import type { Context } from 'koa'
import { getGatewayManagerInstance } from '../../services/gateway-bootstrap'
import {
  createGeweInvite,
  handleGeweCallback,
  listGeweBindings,
  removeGeweBinding,
  removeGeweInvite,
  upsertGeweBinding,
} from '../../services/hermes/gewe-router'

export async function callback(ctx: Context) {
  const manager = getGatewayManagerInstance()
  if (!manager) {
    ctx.status = 503
    ctx.body = { ok: false, error: 'GatewayManager not initialized' }
    return
  }
  const result = await handleGeweCallback(ctx.request.body, ctx.headers, manager)
  ctx.status = result.ok ? 200 : 400
  ctx.body = result
}

export async function list(ctx: Context) {
  ctx.body = await listGeweBindings()
}

export async function bind(ctx: Context) {
  const body = ctx.request.body as { user_id?: string; profile?: string; user_name?: string }
  try {
    const binding = await upsertGeweBinding(body.user_id || '', body.profile || '', body.user_name || '')
    ctx.body = { ok: true, binding }
  } catch (err: any) {
    ctx.status = 400
    ctx.body = { ok: false, error: err?.message || 'failed to bind user' }
  }
}

export async function unbind(ctx: Context) {
  const userId = String(ctx.params.userId || '')
  ctx.body = { ok: true, removed: await removeGeweBinding(userId) }
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
