<script setup lang="ts">
import { computed, h, onMounted, reactive, ref, watch } from 'vue'
import { NButton, NDataTable, NInput, NSelect, NSpace, NSpin, NSwitch, NTag, useMessage } from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import SettingRow from '@/components/hermes/settings/SettingRow.vue'
import { useProfilesStore } from '@/stores/hermes/profiles'
import * as geweApi from '@/api/hermes/gewe'
import type { GeweBinding, GeweInvite } from '@/api/hermes/gewe'

const { t } = useI18n()
const message = useMessage()
const profilesStore = useProfilesStore()

const loading = ref(false)
const saving = reactive<Record<string, boolean>>({})
const selectedProfile = ref('default')
const common = ref<Record<string, any>>({})
const profileConfig = ref<Record<string, any>>({})
const bindings = ref<GeweBinding[]>([])
const invites = ref<GeweInvite[]>([])
const manualUserId = ref('')
const manualUserName = ref('')
const inviteLabel = ref('')

const profileOptions = computed(() => profilesStore.profiles.map(p => ({ label: p.name, value: p.name })))
const callbackUrl = computed(() => `${window.location.origin}/gewe/callback`)

const inboundModeOptions = [
  { label: 'Web UI callback', value: 'web-ui-callback' },
  { label: 'Webhook-router callback', value: 'relay-callback' },
  { label: 'Webhook-router SSE', value: 'relay-sse' },
]

const groupPolicyOptions = [
  { label: t('gewe.groupPolicyPaired'), value: 'paired' },
  { label: t('gewe.groupPolicyAllowlist'), value: 'allowlist' },
  { label: t('gewe.groupPolicyOpen'), value: 'open' },
  { label: t('gewe.groupPolicyDisabled'), value: 'disabled' },
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
    const [config, bindingData] = await Promise.all([
      geweApi.fetchGeweConfig(selectedProfile.value),
      geweApi.fetchGeweBindings(),
    ])
    common.value = config.common || {}
    profileConfig.value = config.profile || {}
    bindings.value = bindingData.bindings || []
    invites.value = bindingData.invites || []
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

async function createInvite() {
  saving.invite = true
  try {
    await geweApi.createGeweInvite(selectedProfile.value, inviteLabel.value)
    inviteLabel.value = ''
    const data = await geweApi.fetchGeweBindings()
    bindings.value = data.bindings
    invites.value = data.invites
    message.success(t('gewe.inviteCreated'))
  } catch (err: any) {
    message.error(err?.message || t('settings.saveFailed'))
  } finally {
    saving.invite = false
  }
}

async function createManualBinding() {
  if (!manualUserId.value.trim()) return
  saving.manual = true
  try {
    await geweApi.upsertGeweBinding(manualUserId.value, selectedProfile.value, manualUserName.value)
    manualUserId.value = ''
    manualUserName.value = ''
    const data = await geweApi.fetchGeweBindings()
    bindings.value = data.bindings
    invites.value = data.invites
    message.success(t('settings.saved'))
  } catch (err: any) {
    message.error(err?.message || t('settings.saveFailed'))
  } finally {
    saving.manual = false
  }
}

async function removeBinding(row: GeweBinding) {
  await geweApi.deleteGeweBinding(row.user_id)
  const data = await geweApi.fetchGeweBindings()
  bindings.value = data.bindings
  invites.value = data.invites
}

async function removeInvite(row: GeweInvite) {
  await geweApi.deleteGeweInvite(row.code)
  const data = await geweApi.fetchGeweBindings()
  bindings.value = data.bindings
  invites.value = data.invites
}

function copy(value: string) {
  navigator.clipboard?.writeText(value)
  message.success(t('common.copied'))
}

const bindingColumns: DataTableColumns<GeweBinding> = [
  { title: t('gewe.wxid'), key: 'user_id' },
  { title: t('gewe.profile'), key: 'profile' },
  { title: t('gewe.name'), key: 'user_name' },
  {
    title: t('common.delete'),
    key: 'actions',
    render(row) {
      return h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => removeBinding(row) }, { default: () => t('common.delete') })
    },
  },
]

const inviteColumns: DataTableColumns<GeweInvite> = [
  {
    title: t('gewe.inviteCode'),
    key: 'code',
    render(row) {
      return h(NSpace, { align: 'center', size: 6 }, {
        default: () => [
          h(NTag, { size: 'small', bordered: false }, { default: () => row.code }),
          h(NButton, { size: 'tiny', quaternary: true, onClick: () => copy(`/pair ${row.code}`) }, { default: () => t('common.copy') }),
        ],
      })
    },
  },
  { title: t('gewe.profile'), key: 'profile' },
  { title: t('gewe.name'), key: 'label' },
  {
    title: t('common.delete'),
    key: 'actions',
    render(row) {
      return h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => removeInvite(row) }, { default: () => t('common.delete') })
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
          <SettingRow :label="t('gewe.callbackUrl')" :hint="t('gewe.callbackUrlHint')">
            <NSpace align="center" :wrap="false" class="input-lg">
              <NInput :value="callbackUrl" readonly size="small" />
              <NButton size="small" @click="copy(callbackUrl)">{{ t('common.copy') }}</NButton>
            </NSpace>
          </SettingRow>
          <SettingRow :label="t('platform.geweCallbackSecret')" :hint="t('platform.geweCallbackSecretHint')">
            <NInput :default-value="common.callback_secret || ''" clearable size="small" class="input-lg" @change="v => saveCommon('callback_secret', { callback_secret: v })" />
          </SettingRow>
          <SettingRow :label="t('platform.geweInboundMode')" :hint="t('gewe.inboundHint')">
            <NSelect :value="common.inbound_mode || 'web-ui-callback'" :options="inboundModeOptions" size="small" class="input-lg" @update:value="v => saveCommon('inbound_mode', { inbound_mode: v })" />
          </SettingRow>
          <SettingRow :label="t('platform.geweRelayBaseUrl')" :hint="t('platform.geweRelayBaseUrlHint')">
            <NInput :default-value="common.relay_base_url || ''" clearable size="small" class="input-lg" @change="v => saveCommon('relay_base_url', { relay_base_url: v })" />
          </SettingRow>
          <SettingRow :label="t('platform.geweRelayApp')" :hint="t('platform.geweRelayAppHint')">
            <div class="split-inputs input-lg">
              <NInput :default-value="common.relay_app_id || ''" clearable size="small" placeholder="app id" @change="v => saveCommon('relay_app_id', { relay_app_id: v })" />
              <NInput :default-value="common.relay_app_token || ''" clearable size="small" placeholder="app token" @change="v => saveCommon('relay_app_token', { relay_app_token: v })" />
              <NInput :default-value="common.relay_channel || ''" clearable size="small" placeholder="channel" @change="v => saveCommon('relay_channel', { relay_channel: v })" />
            </div>
          </SettingRow>
          <SettingRow :label="t('platform.geweRelaySseUrl')" :hint="t('platform.geweRelaySseUrlHint')">
            <NInput :default-value="common.relay_sse_url || ''" clearable size="small" class="input-lg" @change="v => saveCommon('relay_sse_url', { relay_sse_url: v })" />
          </SettingRow>
          <SettingRow :label="t('platform.geweGroupPolicy')" :hint="t('platform.geweGroupPolicyHint')">
            <NSelect :value="common.group_policy || 'paired'" :options="groupPolicyOptions" size="small" class="input-lg" @update:value="v => saveCommon('group_policy', { group_policy: v })" />
          </SettingRow>
          <SettingRow :label="t('platform.geweGroupRequireMention')" :hint="t('platform.geweGroupRequireMentionHint')">
            <NSwitch :value="!!common.group_require_mention" @update:value="v => saveCommon('group_require_mention', { group_require_mention: v })" />
          </SettingRow>
          <SettingRow :label="t('platform.geweGroupAllowedChats')" :hint="t('platform.geweGroupAllowedChatsHint')">
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
              <h3>{{ t('gewe.bindings') }}</h3>
              <p>{{ t('gewe.bindingsHint') }}</p>
            </div>
          </div>

          <div class="inline-form">
            <NInput v-model:value="manualUserId" size="small" :placeholder="t('gewe.wxidPlaceholder')" />
            <NInput v-model:value="manualUserName" size="small" :placeholder="t('gewe.namePlaceholder')" />
            <NButton size="small" type="primary" :loading="saving.manual" @click="createManualBinding">{{ t('gewe.bindToProfile') }}</NButton>
          </div>
          <NDataTable size="small" :columns="bindingColumns" :data="bindings" :bordered="false" />
        </section>

        <section class="settings-block">
          <div class="block-header">
            <div>
              <h3>{{ t('gewe.invites') }}</h3>
              <p>{{ t('gewe.invitesHint') }}</p>
            </div>
          </div>
          <div class="inline-form">
            <NInput v-model:value="inviteLabel" size="small" :placeholder="t('gewe.namePlaceholder')" />
            <NButton size="small" type="primary" :loading="saving.invite" @click="createInvite">{{ t('gewe.createInvite') }}</NButton>
          </div>
          <NDataTable size="small" :columns="inviteColumns" :data="invites" :bordered="false" />
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
.inline-form {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.inline-form {
  grid-template-columns: minmax(180px, 1fr) minmax(160px, 1fr) auto;
  margin: 12px 0;
}

@media (max-width: 720px) {
  .block-header,
  .inline-form,
  .split-inputs {
    grid-template-columns: 1fr;
    flex-direction: column;
  }

  .profile-select {
    width: 100%;
  }
}
</style>
