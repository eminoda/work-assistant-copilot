<script setup lang="ts">
import { shallowRef } from 'vue'
import type { RecordingEvent } from '@workcopilot/browser-recorder'
import RuntimeConnection from './components/RuntimeConnection.vue'
import RecorderPanel from './components/RecorderPanel.vue'
import WorkflowList from './components/WorkflowList.vue'
import { useRuntime } from './composables/useRuntime'

const active = shallowRef(false)
const events = shallowRef<RecordingEvent[]>([])
const message = shallowRef('')
const runtime = useRuntime()
async function start() {
  const state = await chrome.runtime.sendMessage({ type: 'recorder.start' })
  active.value = state.active; events.value = state.events
}
async function stop() {
  const state = await chrome.runtime.sendMessage({ type: 'recorder.stop' })
  active.value = state.active; events.value = state.events
  if (events.value.length) {
    await runtime.saveRecording(`Recording ${new Date().toLocaleString()}`, events.value)
    message.value = 'Workflow saved'
  }
}
async function execute(id: string) {
  const result = await runtime.execute(id)
  message.value = `Execution queued: ${result.executionId}`
}
</script>
<template>
  <main class="shell">
    <header><div class="mark">W</div><div><h1>WorkCopilot</h1><p>Local AI worker runtime</p></div></header>
    <RuntimeConnection :status="runtime.status.value" @connect="runtime.connect" />
    <RecorderPanel :active="active" :count="events.length" @start="start" @stop="stop" />
    <WorkflowList :workflows="[...runtime.workflows.value]" @execute="execute" />
    <p v-if="message" class="notice">{{ message }}</p>
  </main>
</template>
