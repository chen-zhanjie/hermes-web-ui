import { request } from '../client'

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

export interface GewePageConfig {
  common: Record<string, any>
  profile: Record<string, any>
}

export async function fetchGeweConfig(profile: string): Promise<GewePageConfig> {
  return request<GewePageConfig>(`/api/hermes/gewe-router/config?profile=${encodeURIComponent(profile)}`)
}

export async function saveGeweCommon(values: Record<string, any>): Promise<Record<string, any>> {
  const res = await request<{ ok: boolean; common: Record<string, any> }>('/api/hermes/gewe-router/config/common', {
    method: 'PUT',
    body: JSON.stringify({ values }),
  })
  return res.common
}

export async function saveGeweProfile(profile: string, values: Record<string, any>): Promise<Record<string, any>> {
  const res = await request<{ ok: boolean; profile: Record<string, any> }>(`/api/hermes/gewe-router/config/profiles/${encodeURIComponent(profile)}`, {
    method: 'PUT',
    body: JSON.stringify({ values }),
  })
  return res.profile
}

export async function fetchGeweBindings(): Promise<{ bindings: GeweBinding[]; invites: GeweInvite[] }> {
  return request<{ bindings: GeweBinding[]; invites: GeweInvite[] }>('/api/hermes/gewe-router/bindings')
}

export async function createGeweInvite(profile: string, label = ''): Promise<GeweInvite> {
  const res = await request<{ ok: boolean; invite: GeweInvite }>('/api/hermes/gewe-router/invites', {
    method: 'POST',
    body: JSON.stringify({ profile, label }),
  })
  return res.invite
}

export async function deleteGeweInvite(code: string): Promise<void> {
  await request(`/api/hermes/gewe-router/invites/${encodeURIComponent(code)}`, { method: 'DELETE' })
}

export async function upsertGeweBinding(user_id: string, profile: string, user_name = ''): Promise<GeweBinding> {
  const res = await request<{ ok: boolean; binding: GeweBinding }>('/api/hermes/gewe-router/bindings', {
    method: 'POST',
    body: JSON.stringify({ user_id, profile, user_name }),
  })
  return res.binding
}

export async function deleteGeweBinding(userId: string): Promise<void> {
  await request(`/api/hermes/gewe-router/bindings/${encodeURIComponent(userId)}`, { method: 'DELETE' })
}
