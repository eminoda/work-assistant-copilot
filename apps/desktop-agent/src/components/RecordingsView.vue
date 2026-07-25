<script setup lang="ts">
import { computed, onMounted, shallowRef } from 'vue'
import type { RecordingRow, WorkflowSummary } from '../composables/useRuntimeClient'

const props = defineProps<{
  connected: boolean
  listWorkflows: () => Promise<WorkflowSummary[]>
  getWorkflow: (id: string) => Promise<WorkflowSummary>
  listRecordings: () => Promise<RecordingRow[]>
  getRecording: (id: string) => Promise<RecordingRow & { events?: unknown }>
}>()

const tab = shallowRef<'workflows' | 'recordings'>('workflows')
const loading = shallowRef(false)
const error = shallowRef('')
const workflows = shallowRef<WorkflowSummary[]>([])
const recordings = shallowRef<RecordingRow[]>([])
const selectedWorkflowId = shallowRef<string | null>(null)
const selectedRecordingId = shallowRef<string | null>(null)
const workflowDetail = shallowRef<WorkflowSummary | null>(null)
const recordingDetail = shallowRef<(RecordingRow & { events?: unknown }) | null>(null)
const detailLoading = shallowRef(false)

const dslJson = computed(() => {
  const steps = workflowDetail.value?.steps
  if (!steps?.length) return ''
  return JSON.stringify(steps, null, 2)
})

async function reload() {
  if (!props.connected) {
    error.value = '请先连接 Runtime'
    workflows.value = []
    recordings.value = []
    return
  }
  loading.value = true
  error.value = ''
  try {
    const [wf, rec] = await Promise.all([props.listWorkflows(), props.listRecordings()])
    workflows.value = wf
    recordings.value = rec
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载失败'
  } finally {
    loading.value = false
  }
}

async function openWorkflow(id: string) {
  selectedWorkflowId.value = id
  selectedRecordingId.value = null
  recordingDetail.value = null
  detailLoading.value = true
  try {
    workflowDetail.value = await props.getWorkflow(id)
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载工作流失败'
    workflowDetail.value = null
  } finally {
    detailLoading.value = false
  }
}

async function openRecording(id: string) {
  selectedRecordingId.value = id
  selectedWorkflowId.value = null
  workflowDetail.value = null
  detailLoading.value = true
  try {
    recordingDetail.value = await props.getRecording(id)
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载录制失败'
    recordingDetail.value = null
  } finally {
    detailLoading.value = false
  }
}

function switchTab(next: 'workflows' | 'recordings') {
  tab.value = next
}

onMounted(() => {
  void reload()
})
</script>

<template>
  <section>
    <div class="eyebrow">RECORDINGS</div>
    <h1>录制</h1>
    <p class="lead">查询工作流 DSL 与原始录制记录。</p>

    <div class="btn-row" style="margin-top: 12px">
      <button
        class="secondary-action"
        type="button"
        :data-on="tab === 'workflows'"
        @click="switchTab('workflows')"
      >
        工作流
      </button>
      <button
        class="secondary-action"
        type="button"
        :data-on="tab === 'recordings'"
        @click="switchTab('recordings')"
      >
        原始录制
      </button>
      <button class="secondary-action" type="button" :disabled="loading" @click="reload">
        {{ loading ? '刷新中…' : '刷新' }}
      </button>
    </div>
    <p v-if="error" class="error">{{ error }}</p>

    <div class="split-pane">
      <div class="split-list">
        <template v-if="tab === 'workflows'">
          <p v-if="!workflows.length && !loading" class="empty">暂无工作流。</p>
          <button
            v-for="item in workflows"
            :key="item.id"
            type="button"
            class="split-item"
            :data-active="selectedWorkflowId === item.id"
            @click="openWorkflow(item.id)"
          >
            <strong>{{ item.name }}</strong>
            <small>{{ item.kind || item.intent }} · {{ item.steps?.length ?? 0 }} steps</small>
          </button>
        </template>
        <template v-else>
          <p v-if="!recordings.length && !loading" class="empty">暂无原始录制。</p>
          <button
            v-for="item in recordings"
            :key="item.id"
            type="button"
            class="split-item"
            :data-active="selectedRecordingId === item.id"
            @click="openRecording(item.id)"
          >
            <strong>{{ item.name }}</strong>
            <small>{{ item.intent }} · {{ item.status }}</small>
          </button>
        </template>
      </div>

      <div class="split-detail">
        <p v-if="detailLoading" class="hint">加载中…</p>

        <template v-else-if="workflowDetail">
          <h2>{{ workflowDetail.name }}</h2>
          <dl class="meta-grid">
            <div><dt>Intent</dt><dd>{{ workflowDetail.intent }}</dd></div>
            <div><dt>Kind</dt><dd>{{ workflowDetail.kind || '—' }}</dd></div>
            <div><dt>Home URL</dt><dd>{{ workflowDetail.homeUrl || '—' }}</dd></div>
            <div><dt>步骤数</dt><dd>{{ workflowDetail.steps?.length ?? 0 }}</dd></div>
          </dl>
          <h3>步骤 DSL</h3>
          <ol v-if="workflowDetail.steps?.length" class="dsl-steps">
            <li v-for="step in workflowDetail.steps" :key="step.id">
              <code>{{ step.tool }}</code>
              <pre>{{ JSON.stringify(step.params, null, 2) }}</pre>
            </li>
          </ol>
          <p v-else class="hint">无步骤</p>
          <details v-if="dslJson" class="dsl-raw">
            <summary>原始 JSON</summary>
            <pre>{{ dslJson }}</pre>
          </details>
        </template>

        <template v-else-if="recordingDetail">
          <h2>{{ recordingDetail.name }}</h2>
          <dl class="meta-grid">
            <div><dt>Intent</dt><dd>{{ recordingDetail.intent }}</dd></div>
            <div><dt>Status</dt><dd>{{ recordingDetail.status }}</dd></div>
            <div><dt>URL</dt><dd>{{ recordingDetail.url || '—' }}</dd></div>
            <div><dt>创建</dt><dd>{{ new Date(recordingDetail.createdAt).toLocaleString() }}</dd></div>
          </dl>
          <h3>Events</h3>
          <pre class="dsl-json">{{ JSON.stringify(recordingDetail.events ?? [], null, 2) }}</pre>
        </template>

        <p v-else class="empty">选择左侧条目查看 DSL / 事件</p>
      </div>
    </div>
  </section>
</template>
