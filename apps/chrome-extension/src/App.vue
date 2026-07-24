<script setup lang="ts">
import { computed, onMounted, onUnmounted, shallowRef } from 'vue'
import type { RecordingEvent } from '@workcopilot/browser-recorder'
import StatusTags from './components/StatusTags.vue'
import ActionDock from './components/ActionDock.vue'
import WorkflowList from './components/WorkflowList.vue'
import RenameWorkflowPrompt from './components/RenameWorkflowPrompt.vue'
import SettingsView from './components/SettingsView.vue'
import ComingSoonView from './components/ComingSoonView.vue'
import RecordingView from './components/RecordingView.vue'
import WorkflowDetailView from './components/WorkflowDetailView.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import { useRuntime } from './composables/useRuntime'
import type { RecorderState } from './types'
import type { WorkflowSummary } from './workflowTypes'

const view = shallowRef<'home' | 'settings' | 'notify' | 'chat' | 'record' | 'detail'>('home')
const active = shallowRef(false)
const paused = shallowRef(false)
const extractArmed = shallowRef(false)
const events = shallowRef<RecordingEvent[]>([])
const pendingEvents = shallowRef<RecordingEvent[] | null>(null)
const pendingName = shallowRef('')
const pendingKind = shallowRef<'login' | 'app'>('app')
const naming = shallowRef(false)
const saveError = shallowRef('')
const saving = shallowRef(false)
const credentialKeys = shallowRef<string[]>([])
const message = shallowRef('')
const elapsedMs = shallowRef(0)
const detailWorkflow = shallowRef<WorkflowSummary | null>(null)
const detailLoading = shallowRef(false)
const detailError = shallowRef('')
const detailDeleteId = shallowRef<string | null>(null)
const runningWorkflowIds = shallowRef<string[]>([])
const executionIdsByWorkflow = shallowRef<Record<string, string>>({})
const pendingStopIds = shallowRef<string[]>([])
const stoppedWorkflowIds = shallowRef<string[]>([])
const runtime = useRuntime()

let timerStartedAt = 0
let elapsedOffset = 0
let timerId: ReturnType<typeof setInterval> | undefined

const connected = computed(() => {
  const status = runtime.status.value.toLowerCase()
  return status.includes('connect') || status === 'ready' || status === 'ok'
})

function applyState(state: RecorderState) {
  active.value = state.active
  paused.value = state.paused
  extractArmed.value = state.extractArmed
  events.value = state.events
}

function stopTimer() {
  if (timerId) clearInterval(timerId)
  timerId = undefined
}

function tickTimer() {
  if (!active.value || paused.value) return
  elapsedMs.value = elapsedOffset + (Date.now() - timerStartedAt)
}

function startTimer(reset = true) {
  stopTimer()
  if (reset) {
    elapsedOffset = 0
    elapsedMs.value = 0
  }
  timerStartedAt = Date.now()
  timerId = setInterval(tickTimer, 250)
}

function pauseTimer() {
  tickTimer()
  elapsedOffset = elapsedMs.value
  stopTimer()
}

function resumeTimer() {
  timerStartedAt = Date.now()
  timerId = setInterval(tickTimer, 250)
}

function defaultWorkflowName() {
  return `Recording ${new Date().toLocaleString()}`
}

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

function resetPending() {
  pendingEvents.value = null
  pendingName.value = ''
  pendingKind.value = 'app'
  naming.value = false
  saveError.value = ''
  saving.value = false
  credentialKeys.value = []
}

async function openRecording() {
  if (view.value === 'record' && active.value) return
  active.value = false
  paused.value = false
  extractArmed.value = false
  events.value = []
  stopTimer()
  elapsedMs.value = 0
  resetPending()
  message.value = ''
  view.value = 'record'
}

async function startRecording() {
  if (active.value) return
  const state = await chrome.runtime.sendMessage({ type: 'recorder.start' }) as RecorderState
  applyState(state)
  startTimer(true)
  message.value = '正在录制…'
}

async function persist(list: RecordingEvent[], name: string, kind: 'login' | 'app') {
  const sanitized = await storeSessionCookies(list)
  await runtime.saveRecording(name, sanitized, kind)
  events.value = sanitized
  resetPending()
  message.value = `已保存：${name}（${kind === 'login' ? '登录' : '应用'}）`
  view.value = 'home'
}

async function finishRecording() {
  if (!active.value) {
    message.value = '尚未开始录制'
    return
  }
  const state = await chrome.runtime.sendMessage({ type: 'recorder.stop' }) as RecorderState
  applyState(state)
  stopTimer()
  if (!state.events.length) {
    message.value = '没有可保存的操作'
    view.value = 'home'
    return
  }
  pendingEvents.value = state.events
  pendingName.value = defaultWorkflowName()
  credentialKeys.value = credentialKeysFrom(state.events)
  naming.value = true
}

async function cancelRecording() {
  if (active.value) {
    await chrome.runtime.sendMessage({ type: 'recorder.stop' })
  }
  active.value = false
  paused.value = false
  extractArmed.value = false
  events.value = []
  stopTimer()
  elapsedMs.value = 0
  resetPending()
  message.value = '已取消录制'
  view.value = 'home'
}

async function pauseRecording() {
  const state = await chrome.runtime.sendMessage({ type: 'recorder.pause' }) as RecorderState
  applyState(state)
  pauseTimer()
}

async function resumeRecording() {
  const state = await chrome.runtime.sendMessage({ type: 'recorder.resume' }) as RecorderState
  applyState(state)
  resumeTimer()
}

async function insertWait() {
  if (!active.value) {
    message.value = '请先开始录制'
    return
  }
  const state = await chrome.runtime.sendMessage({ type: 'recorder.waitNavigation' }) as RecorderState
  applyState(state)
  message.value = '已插入等待跳转（90s），完成二维码/短信后页面跳转即可'
}

async function toggleExtractArm() {
  if (!active.value) {
    message.value = '请先开始录制'
    return
  }
  const state = await chrome.runtime.sendMessage({
    type: 'recorder.armExtract',
    armed: !extractArmed.value,
  }) as RecorderState
  applyState(state)
  message.value = state.extractArmed ? '请在页面上拖选要提取的文字' : ''
}

async function acceptSave(payload: {
  name: string
  kind: 'login' | 'app'
  credentials: Record<string, string>
}) {
  const list = pendingEvents.value
  if (!list?.length) {
    resetPending()
    view.value = 'home'
    return
  }
  saveError.value = ''
  saving.value = true
  try {
    for (const [key, value] of Object.entries(payload.credentials)) {
      await runtime.saveCredential(key, value)
    }
    await persist(list, payload.name, payload.kind)
  } catch (error) {
    saveError.value = error instanceof Error ? error.message : '保存失败'
  } finally {
    saving.value = false
  }
}

function discardNaming() {
  resetPending()
  events.value = []
  message.value = '已丢弃本次录制'
  view.value = 'home'
}

async function execute(id: string) {
  if (runningWorkflowIds.value.includes(id)) return
  runningWorkflowIds.value = [...runningWorkflowIds.value, id]
  if (view.value === 'detail') view.value = 'home'
  try {
    const result = await runtime.execute(id)
    executionIdsByWorkflow.value = { ...executionIdsByWorkflow.value, [id]: result.executionId }
    if (pendingStopIds.value.includes(id) || stoppedWorkflowIds.value.includes(id)) {
      pendingStopIds.value = pendingStopIds.value.filter((item) => item !== id)
      if (!stoppedWorkflowIds.value.includes(id)) {
        stoppedWorkflowIds.value = [...stoppedWorkflowIds.value, id]
      }
      message.value = '正在停止…'
      await runtime.cancelExecution(result.executionId)
    } else {
      message.value = `正在执行…`
    }
    const finished = await runtime.waitForExecution(result.executionId, {
      onUpdate: (execution) => {
        if (stoppedWorkflowIds.value.includes(id) || pendingStopIds.value.includes(id)) {
          message.value = '正在停止…'
          return
        }
        message.value = execution.phase === 'browser' ? '浏览器运行中…' : '正在执行…'
      },
    })
    const status = String(finished.status || '').toUpperCase()
    if (stoppedWorkflowIds.value.includes(id)) {
      message.value = '已关闭浏览器'
    } else {
      message.value = status === 'SUCCESS'
        ? '执行完成'
        : status === 'CANCELLED'
          ? '已停止'
          : `执行结束：${status}${finished.error ? ` — ${finished.error}` : ''}`
    }
  } catch (error) {
    message.value = error instanceof Error ? error.message : '执行失败'
  } finally {
    pendingStopIds.value = pendingStopIds.value.filter((item) => item !== id)
    stoppedWorkflowIds.value = stoppedWorkflowIds.value.filter((item) => item !== id)
    const { [id]: _, ...rest } = executionIdsByWorkflow.value
    executionIdsByWorkflow.value = rest
    runningWorkflowIds.value = runningWorkflowIds.value.filter((item) => item !== id)
  }
}

async function stopExecution(id: string) {
  if (!stoppedWorkflowIds.value.includes(id)) {
    stoppedWorkflowIds.value = [...stoppedWorkflowIds.value, id]
  }
  const executionId = executionIdsByWorkflow.value[id]
  if (!executionId) {
    if (!pendingStopIds.value.includes(id)) {
      pendingStopIds.value = [...pendingStopIds.value, id]
    }
    message.value = '正在停止…'
    return
  }
  message.value = '正在停止…'
  try {
    await runtime.cancelExecution(executionId)
  } catch (error) {
    message.value = error instanceof Error ? error.message : '停止失败'
  }
}

async function openWorkflowDetail(id: string) {
  detailLoading.value = true
  detailError.value = ''
  detailWorkflow.value = null
  view.value = 'detail'
  try {
    detailWorkflow.value = await runtime.getWorkflow(id)
  } catch (error) {
    detailError.value = error instanceof Error ? error.message : '加载失败'
  } finally {
    detailLoading.value = false
  }
}

async function removeWorkflow(id: string) {
  await runtime.deleteWorkflow(id)
  message.value = '工作流已删除'
  detailWorkflow.value = null
  detailDeleteId.value = null
  if (view.value === 'detail') view.value = 'home'
}

function askRemoveFromDetail(id: string) {
  detailDeleteId.value = id
}

async function confirmRemoveFromDetail() {
  const id = detailDeleteId.value
  if (!id) return
  await removeWorkflow(id)
}

async function removeAllWorkflows() {
  if (!runtime.workflows.value.length) return
  await runtime.deleteAllWorkflows()
  message.value = '已删除全部工作流'
}

async function connectFromSettings(token: string) {
  await runtime.connect(token)
  message.value = '已连接本地 Runtime'
  view.value = 'home'
}

function leaveSecondary() {
  if (active.value) {
    void cancelRecording()
    return
  }
  detailWorkflow.value = null
  detailError.value = ''
  detailDeleteId.value = null
  view.value = 'home'
}

function onRuntimeMessage(message: RecorderState & { type?: string }) {
  if (message.type === 'recorder.status' && Array.isArray(message.events)) {
    applyState({
      active: message.active,
      paused: message.paused,
      extractArmed: message.extractArmed,
      events: message.events,
    })
  }
}

onMounted(() => {
  chrome.runtime.onMessage.addListener(onRuntimeMessage)
  const saved = runtime.token.value.trim()
  if (saved) {
    void runtime.connect(saved).catch((error) => {
      message.value = error instanceof Error ? error.message : '自动连接 Runtime 失败'
    })
  }
})

onUnmounted(() => {
  chrome.runtime.onMessage.removeListener(onRuntimeMessage)
  stopTimer()
})
</script>

<template>
  <main class="shell" :data-view="view">
    <header v-if="view === 'home' || view === 'settings'">
      <div class="brand">
        <div class="mark">W</div>
        <div>
          <h1>Work Copilot</h1>
        </div>
      </div>
      <button
        v-if="view === 'home'"
        class="icon-btn"
        type="button"
        aria-label="设置"
        title="设置"
        @click="view = 'settings'"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.2 7.2 0 0 0-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.48.41l-.36 2.54c-.57.22-1.11.52-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87a.49.49 0 0 0 .12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.86 14.5a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.42 1.05.76 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54c.57-.22 1.11-.52 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"
          />
        </svg>
      </button>
    </header>

    <SettingsView
      v-if="view === 'settings'"
      :status="runtime.status.value"
      :initial-token="runtime.token.value"
      :connect="connectFromSettings"
      @back="view = 'home'"
    />

    <ComingSoonView
      v-else-if="view === 'notify'"
      title="通知"
      description="消息通知与定时策略即将上线，敬请期待。"
      @back="leaveSecondary"
      @close="leaveSecondary"
    />

    <ComingSoonView
      v-else-if="view === 'chat'"
      title="AI 聊天"
      description="与本地 AI Runtime 对话即将上线，敬请期待。"
      @back="leaveSecondary"
      @close="leaveSecondary"
    />

    <template v-else-if="view === 'detail'">
      <WorkflowDetailView
        v-if="detailWorkflow || detailLoading || detailError"
        :workflow="detailWorkflow || { id: '', name: '…', intent: '' }"
        :loading="detailLoading"
        :error="detailError"
        @back="leaveSecondary"
        @close="leaveSecondary"
        @execute="execute"
        @remove="askRemoveFromDetail"
      />
      <ConfirmDialog
        v-if="detailDeleteId && detailWorkflow"
        title="删除工作流"
        :message="`确定删除「${detailWorkflow.name}」？此操作不可恢复。`"
        @cancel="detailDeleteId = null"
        @confirm="confirmRemoveFromDetail"
      />
    </template>

    <template v-else-if="view === 'record'">
      <RecordingView
        :active="active"
        :events="events"
        :paused="paused"
        :extract-armed="extractArmed"
        :elapsed-ms="elapsedMs"
        @back="leaveSecondary"
        @close="leaveSecondary"
        @start="startRecording"
        @pause="pauseRecording"
        @resume="resumeRecording"
        @wait="insertWait"
        @arm-extract="toggleExtractArm"
        @cancel="cancelRecording"
        @complete="finishRecording"
      />
      <RenameWorkflowPrompt
        v-if="naming"
        :default-name="pendingName"
        :credential-keys="credentialKeys"
        :error="saveError"
        :saving="saving"
        @save="acceptSave"
        @cancel="discardNaming"
      />
    </template>

    <template v-else>
      <StatusTags :connected="connected" :recording="active" />
      <ActionDock
        :recording="active"
        @record="openRecording"
        @notify="view = 'notify'"
        @chat="view = 'chat'"
      />
      <WorkflowList
        :workflows="[...runtime.workflows.value]"
        :running-ids="runningWorkflowIds"
        @execute="execute"
        @stop="stopExecution"
        @remove="removeWorkflow"
        @remove-all="removeAllWorkflows"
        @create="openRecording"
        @open="openWorkflowDetail"
      />
      <p v-if="message" class="notice">{{ message }}</p>
    </template>
  </main>
</template>
