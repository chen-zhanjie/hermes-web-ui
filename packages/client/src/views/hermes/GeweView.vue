<script setup lang="ts">
import { computed, h, onMounted, reactive, ref, watch } from 'vue'
import { NButton, NDataTable, NInput, NSelect, NSpace, NSpin, NSwitch, NTag, useMessage } from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import SettingRow from '@/components/hermes/settings/SettingRow.vue'
import { useProfilesStore } from '@/stores/hermes/profiles'
import * as geweApi from '@/api/hermes/gewe'
import type { GeweBinding, GewePairingUser } from '@/api/hermes/gewe'

const { t } = useI18n()
const message = useMessage()
const profilesStore = useProfilesStore()

const loading = ref(false)
const saving = reactive<Record<string, boolean>>({})
const selectedProfile = ref('default')
const common = ref<Record<string, any>>({})
const profileConfig = ref<Record<string, any>>({})
const bindings = ref<GeweBinding[]>([])
const pairingUsers = ref<GewePairingUser[]>([])
const manualBindingType = ref<'user' | 'group'>('user')
const manualUserId = ref('')
const manualUserName = ref('')
const manualListenAll = ref(false)
const selectedPairingIdentity = ref<string | null>(null)

const profileOptions = computed(() => profilesStore.profiles.map(p => ({ label: p.name, value: p.name })))
const inboundMode = computed(() => String(common.value.inbound_mode || 'direct-callback'))
const groupPolicy = computed(() => String(common.value.group_policy || 'paired'))
const usesCallbackIngress = computed(() => ['direct-callback', 'relay-callback'].includes(inboundMode.value))
const usesRelayIngress = computed(() => ['relay-callback', 'relay-sse'].includes(inboundMode.value))
const usesRelaySse = computed(() => inboundMode.value === 'relay-sse')
const usesRelayCallback = computed(() => inboundMode.value === 'relay-callback')
const groupEnabled = computed(() => !['disabled', 'off', 'none'].includes(groupPolicy.value))
const showGroupAllowedChats = computed(() => groupPolicy.value === 'allowlist' || !!String(common.value.group_allowed_chats || '').trim())
const callbackHost = computed(() => String(common.value.callback_host || '0.0.0.0'))
const callbackPort = computed(() => String(common.value.callback_port || '8656'))
const callbackPath = computed(() => String(common.value.callback_path || (usesRelayCallback.value ? '/gewe/relay' : '/gewe/callback')))
const callbackUrl = computed(() => {
  const host = callbackHost.value === '0.0.0.0' ? '127.0.0.1' : callbackHost.value
  const bracketedHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
  const path = callbackPath.value.startsWith('/') ? callbackPath.value : `/${callbackPath.value}`
  return `http://${bracketedHost}:${callbackPort.value}${path}`
})

const inboundModeOptions = [
  { label: t('gewe.inboundModeNativeCallback'), value: 'direct-callback' },
  { label: t('gewe.inboundModeRouterCallback'), value: 'relay-callback' },
  { label: t('gewe.inboundModeRouterSse'), value: 'relay-sse' },
]

const groupPolicyOptions = [
  { label: t('gewe.groupPolicyPaired'), value: 'paired' },
  { label: t('gewe.groupPolicyAllowlist'), value: 'allowlist' },
  { label: t('gewe.groupPolicyOpen'), value: 'open' },
  { label: t('gewe.groupPolicyDisabled'), value: 'disabled' },
]

const pairingUserOptions = computed(() => pairingUsers.value.map(user => ({
  label: `${user.user_name || user.identity} (${user.identity})`,
  value: user.identity,
})))

const selectedPairingUser = computed(() => pairingUsers.value.find(user => user.identity === selectedPairingIdentity.value))

const bindingTypeOptions = [
  { label: t('gewe.bindingTypeUser'), value: 'user' },
  { label: t('gewe.bindingTypeGroup'), value: 'group' },
]

function savingKey(scope: string, field: string) {
  return `${scope}.${field}`
}

function isSaving(scope: string, field: string) {
  return !!saving[savingKey(scope, field)]
}

async function loadAll() {
  loading.value = true
  try {
    if (!profilesStore.profiles.length) await profilesStore.fetchProfiles()
    if (!selectedProfile.value) selectedProfile.value = profilesStore.activeProfileName || 'default'
    const [config, bindingData, userData] = await Promise.all([
      geweApi.fetchGeweConfig(selectedProfile.value),
      geweApi.fetchGeweBindings(),
      geweApi.fetchGewePairingUsers(),
    ])
    common.value = config.common || {}
    profileConfig.value = config.profile || {}
    bindings.value = bindingData.bindings || []
    pairingUsers.value = userData || []
    if (!selectedPairingIdentity.value && pairingUsers.value.length) selectedPairingIdentity.value = pairingUsers.value[0].identity
  } catch (err: any) {
    message.error(err?.message || t('settings.saveFailed'))
  } finally {
    loading.value = false
  }
}

async function saveCommon(field: string, values: Record<string, any>) {
  const key = savingKey('common', field)
  saving[key] = true
  try {
    common.value = await geweApi.saveGeweCommon(values)
    message.success(t('settings.saved'))
  } catch (err: any) {
    message.error(err?.message || t('settings.saveFailed'))
  } finally {
    saving[key] = false
  }
}

async function saveProfile(field: string, values: Record<string, any>) {
  const key = savingKey('profile', field)
  saving[key] = true
  try {
    profileConfig.value = await geweApi.saveGeweProfile(selectedProfile.value, values)
    message.success(t('settings.saved'))
  } catch (err: any) {
    message.error(err?.message || t('settings.saveFailed'))
  } finally {
    saving[key] = false
  }
}

async function createManualBinding() {
  if (!manualUserId.value.trim()) return
  saving.manual = true
  try {
    await geweApi.upsertGeweBinding(manualUserId.value, selectedProfile.value, manualUserName.value, manualBindingType.value, manualListenAll.value)
    manualUserId.value = ''
    manualUserName.value = ''
    manualListenAll.value = false
    await reloadBindingData()
    message.success(t('settings.saved'))
  } catch (err: any) {
    message.error(err?.message || t('settings.saveFailed'))
  } finally {
    saving.manual = false
  }
}

async function reloadBindingData() {
  const [bindingData, userData] = await Promise.all([
    geweApi.fetchGeweBindings(),
    geweApi.fetchGewePairingUsers(),
  ])
  bindings.value = bindingData.bindings || []
  pairingUsers.value = userData || []
}

async function bindSelectedPairingUser(row?: GewePairingUser) {
  const target = row || selectedPairingUser.value
  if (!target?.identity) return
  saving.pairing = true
  try {
    await geweApi.upsertGeweBinding(target.identity, selectedProfile.value, target.user_name || '', 'user', false)
    await reloadBindingData()
    selectedPairingIdentity.value = target.identity
    message.success(t('settings.saved'))
  } catch (err: any) {
    message.error(err?.message || t('settings.saveFailed'))
  } finally {
    saving.pairing = false
  }
}

async function removeBinding(row: GeweBinding) {
  await geweApi.deleteGeweBinding(row.identity || row.user_id, row.type || 'user')
  await reloadBindingData()
}

function copy(value: string) {
  navigator.clipboard?.writeText(value)
  message.success(t('common.copied'))
}

const bindingColumns: DataTableColumns<GeweBinding> = [
  {
    title: t('gewe.bindingType'),
    key: 'type',
    render(row) {
      return h(NTag, { size: 'small', bordered: false }, { default: () => row.type === 'group' ? t('gewe.bindingTypeGroup') : t('gewe.bindingTypeUser') })
    },
  },
  { title: t('gewe.identity'), key: 'identity' },
  { title: t('gewe.profile'), key: 'profile' },
  { title: t('gewe.name'), key: 'name' },
  {
    title: t('gewe.listenAll'),
    key: 'listen_all',
    render(row) {
      return row.type === 'group' && row.listen_all ? t('common.enable') : ''
    },
  },
  {
    title: t('common.delete'),
    key: 'actions',
    render(row) {
      return h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => removeBinding(row) }, { default: () => t('common.delete') })
    },
  },
]

const pairingUserColumns: DataTableColumns<GewePairingUser> = [
  { title: t('gewe.identity'), key: 'identity' },
  { title: t('gewe.name'), key: 'user_name' },
  {
    title: t('gewe.pairingStatus'),
    key: 'status',
    render(row) {
      const label = row.status === 'bound' ? t('gewe.pairingStatusBound') : row.status === 'approved' ? t('gewe.pairingStatusApproved') : t('gewe.pairingStatusPending')
      const type = row.status === 'bound' ? 'success' : row.status === 'approved' ? 'info' : 'warning'
      return h(NTag, { size: 'small', bordered: false, type }, { default: () => label })
    },
  },
  { title: t('gewe.profile'), key: 'profile' },
  {
    title: t('gewe.bindToProfile'),
    key: 'actions',
    render(row) {
      return h(NButton, { size: 'tiny', quaternary: true, type: 'primary', loading: !!saving.pairing && selectedPairingIdentity.value === row.identity, onClick: () => bindSelectedPairingUser(row) }, { default: () => t('gewe.bindToProfile') })
    },
  },
]

watch(selectedProfile, () => loadAll())

onMounted(() => {
  selectedProfile.value = profilesStore.activeProfileName || 'default'
  loadAll()
})
</script>

<template>
  <div class="gewe-view">
    <header class="page-header">
      <h2 class="header-title">{{ t('gewe.title') }}</h2>
    </header>

    <NSpin :show="loading" size="large" :description="t('common.loading')">
      <div v-if="!loading" class="gewe-content">
        <section class="settings-block">
          <div class="block-header">
            <div>
              <h3>{{ t('gewe.commonConfig') }}</h3>
              <p>{{ t('gewe.commonHint') }}</p>
            </div>
            <NTag :type="common.enabled ? 'success' : 'default'" size="small">{{ common.enabled ? t('common.enable') : t('common.disable') }}</NTag>
          </div>

          <SettingRow :label="t('platform.geweEnabled')" :hint="t('gewe.sharedEnabledHint')">
            <NSwitch :value="!!common.enabled" :loading="isSaving('common', 'enabled')" @update:value="v => saveCommon('enabled', { enabled: v })" />
          </SettingRow>
          <SettingRow :label="t('platform.geweToken')" :hint="t('platform.geweTokenHint')">
            <NInput :default-value="common.token || ''" clearable size="small" class="input-lg" @change="v => saveCommon('token', { token: v })" />
          </SettingRow>
          <SettingRow :label="t('platform.geweAppId')" :hint="t('platform.geweAppIdHint')">
            <NInput :default-value="common.app_id || ''" clearable size="small" class="input-lg" @change="v => saveCommon('app_id', { app_id: v })" />
          </SettingRow>
          <SettingRow :label="t('platform.geweBotWxid')" :hint="t('platform.geweBotWxidHint')">
            <NInput :default-value="common.bot_wxid || ''" clearable size="small" class="input-lg" placeholder="wxid_xxx" @change="v => saveCommon('bot_wxid', { bot_wxid: v })" />
          </SettingRow>
          <SettingRow :label="t('platform.geweApiBaseUrl')" :hint="t('platform.geweApiBaseUrlHint')">
            <NInput :default-value="common.api_base_url || ''" clearable size="small" class="input-lg" placeholder="https://api.geweapi.com" @change="v => saveCommon('api_base_url', { api_base_url: v })" />
          </SettingRow>
          <SettingRow :label="t('platform.geweInboundMode')" :hint="t('gewe.inboundHint')">
            <NSelect :value="inboundMode" :options="inboundModeOptions" size="small" class="input-lg" @update:value="v => saveCommon('inbound_mode', { inbound_mode: v })" />
          </SettingRow>
          <SettingRow v-if="usesCallbackIngress" :label="t('gewe.callbackUrl')" :hint="t('gewe.callbackUrlHint')">
            <NSpace align="center" :wrap="false" class="input-lg">
              <NInput :value="callbackUrl" readonly size="small" />
              <NButton size="small" @click="copy(callbackUrl)">{{ t('common.copy') }}</NButton>
            </NSpace>
          </SettingRow>
          <SettingRow v-if="usesCallbackIngress" :label="t('platform.geweCallbackUrl')" :hint="t('platform.geweCallbackUrlHint')">
            <div class="split-inputs input-lg three-cols">
              <NInput :default-value="common.callback_host || '0.0.0.0'" clearable size="small" placeholder="0.0.0.0" @change="v => saveCommon('callback_host', { callback_host: v })" />
              <NInput :default-value="String(common.callback_port || '8656')" clearable size="small" placeholder="8656" @change="v => saveCommon('callback_port', { callback_port: v })" />
              <NInput :default-value="callbackPath" clearable size="small" placeholder="/gewe/callback" @change="v => saveCommon('callback_path', { callback_path: v })" />
            </div>
          </SettingRow>
          <SettingRow v-if="usesCallbackIngress" :label="t('platform.geweCallbackSecret')" :hint="t('platform.geweCallbackSecretHint')">
            <NInput :default-value="common.callback_secret || ''" clearable size="small" class="input-lg" @change="v => saveCommon('callback_secret', { callback_secret: v })" />
          </SettingRow>
          <SettingRow v-if="usesRelayIngress" :label="t('platform.geweRelayBaseUrl')" :hint="t('platform.geweRelayBaseUrlHint')">
            <NInput :default-value="common.relay_base_url || ''" clearable size="small" class="input-lg" @change="v => saveCommon('relay_base_url', { relay_base_url: v })" />
          </SettingRow>
          <SettingRow v-if="usesRelaySse" :label="t('platform.geweRelayApp')" :hint="t('gewe.relaySseAppHint')">
            <div class="split-inputs input-lg two-cols">
              <NInput :default-value="common.relay_app_id || ''" clearable size="small" placeholder="app id" @change="v => saveCommon('relay_app_id', { relay_app_id: v })" />
              <NInput :default-value="common.relay_app_token || ''" clearable size="small" placeholder="app token" @change="v => saveCommon('relay_app_token', { relay_app_token: v })" />
            </div>
          </SettingRow>
          <SettingRow v-if="usesRelayCallback" :label="t('gewe.relayChannel')" :hint="t('gewe.relayChannelHint')">
            <NInput :default-value="common.relay_channel || ''" clearable size="small" class="input-lg" placeholder="channel" @change="v => saveCommon('relay_channel', { relay_channel: v })" />
          </SettingRow>
          <SettingRow :label="t('platform.geweGroupPolicy')" :hint="t('platform.geweGroupPolicyHint')">
            <NSelect :value="common.group_policy || 'paired'" :options="groupPolicyOptions" size="small" class="input-lg" @update:value="v => saveCommon('group_policy', { group_policy: v })" />
          </SettingRow>
          <SettingRow v-if="groupEnabled" :label="t('platform.geweGroupRequireMention')" :hint="t('platform.geweGroupRequireMentionHint')">
            <NSwitch :value="!!common.group_require_mention" @update:value="v => saveCommon('group_require_mention', { group_require_mention: v })" />
          </SettingRow>
          <SettingRow v-if="groupEnabled && showGroupAllowedChats" :label="t('platform.geweGroupAllowedChats')" :hint="t('platform.geweGroupAllowedChatsHint')">
            <NInput :default-value="common.group_allowed_chats || ''" clearable size="small" class="input-lg" placeholder="123@chatroom,456@chatroom" @change="v => saveCommon('group_allowed_chats', { group_allowed_chats: v })" />
          </SettingRow>
        </section>

        <section class="settings-block" :key="selectedProfile">
          <div class="block-header">
            <div>
              <h3>{{ t('gewe.profileConfig') }}</h3>
              <p>{{ t('gewe.profileHint') }}</p>
            </div>
            <NSelect v-model:value="selectedProfile" :options="profileOptions" size="small" class="profile-select" />
          </div>

          <SettingRow :label="t('platform.homeChannel')" :hint="t('platform.geweHomeChannelHint')">
            <NInput :default-value="profileConfig.home_channel || ''" clearable size="small" class="input-lg" placeholder="wxid_xxx or 123@chatroom" @change="v => saveProfile('home_channel', { home_channel: v })" />
          </SettingRow>
          <SettingRow :label="t('platform.homeChannelName')" :hint="t('platform.geweHomeChannelNameHint')">
            <NInput :default-value="profileConfig.home_channel_name || ''" clearable size="small" class="input-lg" placeholder="Home" @change="v => saveProfile('home_channel_name', { home_channel_name: v })" />
          </SettingRow>
        </section>

        <section class="settings-block">
          <div class="block-header">
            <div>
              <h3>{{ t('gewe.discoveredUsers') }}</h3>
              <p>{{ t('gewe.discoveredUsersHint') }}</p>
            </div>
          </div>

          <div class="pairing-form">
            <NSelect v-model:value="selectedPairingIdentity" size="small" :options="pairingUserOptions" :placeholder="t('gewe.noPairingUser')" filterable clearable />
            <NButton size="small" type="primary" :disabled="!selectedPairingIdentity" :loading="saving.pairing" @click="() => bindSelectedPairingUser()">{{ t('gewe.bindSelectedUser') }}</NButton>
          </div>
          <NDataTable size="small" :columns="pairingUserColumns" :data="pairingUsers" :bordered="false" />
        </section>

        <section class="settings-block">
          <div class="block-header">
            <div>
              <h3>{{ t('gewe.bindings') }}</h3>
              <p>{{ t('gewe.bindingsHint') }}</p>
            </div>
          </div>

          <div class="inline-form">
            <NSelect v-model:value="manualBindingType" size="small" :options="bindingTypeOptions" class="binding-type-select" />
            <NInput v-model:value="manualUserId" size="small" :placeholder="t('gewe.wxidPlaceholder')" />
            <NInput v-model:value="manualUserName" size="small" :placeholder="t('gewe.namePlaceholder')" />
            <NSwitch v-if="manualBindingType === 'group'" v-model:value="manualListenAll" size="small">
              <template #checked>{{ t('gewe.listenAll') }}</template>
              <template #unchecked>{{ t('gewe.listenAll') }}</template>
            </NSwitch>
            <NButton size="small" type="primary" :loading="saving.manual" @click="createManualBinding">{{ t('gewe.bindToProfile') }}</NButton>
          </div>
          <NDataTable size="small" :columns="bindingColumns" :data="bindings" :bordered="false" />
        </section>
      </div>
    </NSpin>
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/variables' as *;

.gewe-view {
  height: calc(100 * var(--vh));
  display: flex;
  flex-direction: column;
}

.gewe-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.settings-block {
  background: $bg-secondary;
  border: 1px solid $border-color;
  border-radius: 8px;
  padding: 18px;
}

.block-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 10px;

  h3 {
    margin: 0 0 4px;
    font-size: 15px;
    font-weight: 600;
  }

  p {
    margin: 0;
    color: $text-secondary;
    font-size: 12px;
    line-height: 1.5;
  }
}

.input-lg {
  width: min(620px, 100%);
}

.profile-select {
  width: 180px;
}

.split-inputs,
.inline-form,
.pairing-form {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.two-cols {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.three-cols {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.inline-form {
  grid-template-columns: 120px minmax(180px, 1fr) minmax(160px, 1fr) auto auto;
  align-items: center;
  margin: 12px 0;
}

.pairing-form {
  grid-template-columns: minmax(240px, 1fr) auto;
  align-items: center;
  margin: 12px 0;
}

.binding-type-select {
  width: 120px;
}

@media (max-width: 720px) {
  .block-header,
  .inline-form,
  .pairing-form,
  .split-inputs {
    grid-template-columns: 1fr;
    flex-direction: column;
  }

  .profile-select {
    width: 100%;
  }
}
</style>
