<script setup lang="ts">
import { shallowRef } from 'vue'
import type { RecordingEvent } from '@workcopilot/browser-recorder'
import RuntimeConnection from './components/RuntimeConnection.vue'
import RecorderPanel from './components/RecorderPanel.vue'
import WorkflowList from './components/WorkflowList.vue'
import CredentialPrompt from './components/CredentialPrompt.vue'
import { useRuntime } from './composables/useRuntime'

const active = shallowRef(false)
const events = shallowRef<RecordingEvent[]>([])
const pendingEvents = shallowRef<RecordingEvent[] | null>(null)
const credentialKeys = shallowRef<string[]>([])
const message = shallowRef('')
const runtime = useRuntime()

function credentialKeysFrom(list: RecordingEvent[]) {
  return [...new Set(list.map((event) => event.credentialKey).filter((key): key is string => Boolean(key)))]
}

async function storeSessionCookies(list: RecordingEvent[]) {
  const next = list.map(async (event) => {
    if (event.type !== 'cookies' || !event.cookies?.length) return event
    const key = event.cookieCredentialKey || `${new URL(event.url).hostname}.session`
    await runtime.saveCredential(key, JSON.stringify(event.cookies))
    const { cookies: _omit, ...rest } = event
    return { ...rest, cookieCredentialKey: key }
  })
  return Promise.all(next)
}

async function start() {
  const state = await chrome.runtime.sendMessage({ type: 'recorder.start' })
  active.value = state.active
  events.value = state.events
  pendingEvents.value = null
  credentialKeys.value = []
  message.value = ''
}

async function persist(list: RecordingEvent[]) {
  const sanitized = await storeSessionCookies(list)
  await runtime.saveRecording(`Recording ${new Date().toLocaleString()}`, sanitized)
  events.value = sanitized
  pendingEvents.value = null
  credentialKeys.value = []
  message.value = 'Workflow saved (session cookies stored locally)'
}

async function stop() {
  const state = await chrome.runtime.sendMessage({ type: 'recorder.stop' })
  active.value = state.active
  events.value = state.events
  if (!state.events.length) return

  const keys = credentialKeysFrom(state.events)
  if (keys.length) {
    pendingEvents.value = state.events
    credentialKeys.value = keys
    message.value = 'Enter passwords to finish saving'
    return
  }
  await persist(state.events)
}

async function saveCredentials(values: Record<string, string>) {
  for (const [key, value] of Object.entries(values)) {
    await runtime.saveCredential(key, value)
  }
  if (pendingEvents.value?.length) await persist(pendingEvents.value)
  message.value = 'Credentials saved and workflow stored'
}

async function skipCredentials() {
  if (pendingEvents.value?.length) await persist(pendingEvents.value)
  message.value = 'Workflow saved without passwords — replay will fail until credentials are set'
}

async function execute(id: string) {
  const result = await runtime.execute(id)
  message.value = `Execution queued: ${result.executionId}`
}
</script>

<template>
  <main class="shell">
    <header>
      <div class="mark">W</div>
      <div>
        <h1>WorkCopilot</h1>
        <p>Local AI worker runtime</p>
      </div>
    </header>
    <RuntimeConnection :status="runtime.status.value" @connect="runtime.connect" />
    <RecorderPanel :active="active" :count="events.length" @start="start" @stop="stop" />
    <CredentialPrompt
      v-if="credentialKeys.length"
      :keys="credentialKeys"
      @save="saveCredentials"
      @skip="skipCredentials"
    />
    <WorkflowList :workflows="[...runtime.workflows.value]" @execute="execute" />
    <p v-if="message" class="notice">{{ message }}</p>
  </main>
</template>
