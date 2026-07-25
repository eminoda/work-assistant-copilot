<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import { canLinkPrerequisite, workflowExitUrl } from '../workflowLink'
import ConfirmDialog from './ConfirmDialog.vue'
import type { WorkflowSummary } from '../workflowTypes'

const props = defineProps<{
  workflows: WorkflowSummary[]
  runningIds?: string[]
}>()
const emit = defineEmits<{
  execute: [id: string]
  stop: [id: string]
  remove: [id: string]
  removeAll: []
  create: []
  open: [id: string]
  setPrerequisite: [payload: { id: string; prerequisiteWorkflowId: string | null }]
  rename: [payload: { id: string; name: string }]
}>()

const pending = shallowRef<null | { mode: 'one'; id: string; name: string } | { mode: 'all'; count: number }>(null)
const linkTarget = shallowRef<WorkflowSummary | null>(null)
const linkSelection = shallowRef('')
const renameTarget = shallowRef<WorkflowSummary | null>(null)
const renameName = shallowRef('')
const renameError = shallowRef('')

function kindLabel(kind?: string, intent?: string) {
  if (kind === 'login' || intent?.includes('login')) return '登录'
  return '应用'
}

function isRunning(id: string) {
  return Boolean(props.runningIds?.includes(id))
}

function prerequisiteName(id?: string) {
  if (!id) return ''
  return props.workflows.find((item) => item.id === id)?.name || '已关联'
}

function asWorkflowShape(workflow: WorkflowSummary) {
  return {
    homeUrl: workflow.homeUrl,
    steps: (workflow.steps || []).map((step) => ({
      id: step.id,
      tool: step.tool,
      params: { ...step.params },
      timeoutMs: 30_000,
      retries: 0,
      requiresConfirmation: false,
    })),
  }
}

const linkCandidates = computed(() => {
  const current = linkTarget.value
  if (!current) return []
  return props.workflows.filter((item) => {
    if (item.id === current.id) return false
    return canLinkPrerequisite(asWorkflowShape(item), asWorkflowShape(current))
  })
})

function openLinkDialog(workflow: WorkflowSummary) {
  linkTarget.value = workflow
  linkSelection.value = workflow.prerequisiteWorkflowId || ''
}

function dismissLink() {
  linkTarget.value = null
  linkSelection.value = ''
}

function confirmLink() {
  const current = linkTarget.value
  if (!current) return
  emit('setPrerequisite', {
    id: current.id,
    prerequisiteWorkflowId: linkSelection.value || null,
  })
  dismissLink()
}

function openRenameDialog(workflow: WorkflowSummary) {
  renameTarget.value = workflow
  renameName.value = workflow.name
  renameError.value = ''
}

function dismissRename() {
  renameTarget.value = null
  renameName.value = ''
  renameError.value = ''
}

function confirmRename() {
  const current = renameTarget.value
  const next = renameName.value.trim()
  if (!current) return
  if (!next) {
    renameError.value = '名称不能为空'
    return
  }
  emit('rename', { id: current.id, name: next })
  dismissRename()
}

function askRemoveOne(id: string, name: string) {
  pending.value = { mode: 'one', id, name }
}

function askRemoveAll() {
  if (!props.workflows.length) return
  pending.value = { mode: 'all', count: props.workflows.length }
}

function dismiss() {
  pending.value = null
}

function confirmPending() {
  const current = pending.value
  pending.value = null
  if (!current) return
  if (current.mode === 'one') emit('remove', current.id)
  else emit('removeAll')
}

function candidateHint(workflow: WorkflowSummary) {
  return workflowExitUrl(asWorkflowShape(workflow)) || workflow.homeUrl || ''
}
</script>

<template>
  <section class="workflow-panel">
    <div class="row panel-head">
      <strong>我的工作流</strong>
      <button
        v-if="workflows.length"
        class="text-btn"
        type="button"
        @click="askRemoveAll"
      >
        全部删除
      </button>
    </div>

    <div class="workflow-card">
      <p v-if="workflows.length === 0" class="muted empty">暂无工作流，点上方「录制」开始。</p>
      <article
        v-for="workflow in workflows"
        :key="workflow.id"
        class="workflow-item workflow-item-clickable"
        @click="emit('open', workflow.id)"
      >
        <div class="workflow-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18">
            <path
              fill="currentColor"
              d="M7 3h10a2 2 0 0 1 2 2v14l-7-3-7 3V5a2 2 0 0 1 2-2zm2 4v2h6V7H9zm0 4v2h4v-2H9z"
            />
          </svg>
        </div>
        <div class="workflow-meta">
          <div class="workflow-title">
            <b>{{ workflow.name }}</b>
            <span
              class="kind-badge"
              :data-kind="kindLabel(workflow.kind, workflow.intent) === '登录' ? 'login' : 'app'"
            >{{ kindLabel(workflow.kind, workflow.intent) }}</span>
            <span
              v-if="workflow.prerequisiteWorkflowId"
              class="kind-badge prereq-badge"
              :title="`前置：${prerequisiteName(workflow.prerequisiteWorkflowId)}`"
            >前置 · {{ prerequisiteName(workflow.prerequisiteWorkflowId) }}</span>
          </div>
        </div>
        <div class="actions" @click.stop>
          <button
            class="icon-btn"
            type="button"
            title="重命名"
            aria-label="重命名"
            :disabled="isRunning(workflow.id)"
            @click="openRenameDialog(workflow)"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path
                fill="currentColor"
                d="M4 17.2V20h2.8l8.3-8.3-2.8-2.8L4 17.2zm14.7-8.5c.3-.3.3-.8 0-1.1l-1.3-1.3a.8.8 0 0 0-1.1 0l-1 1 2.8 2.8 1.1-1.4z"
              />
            </svg>
          </button>
          <button
            class="icon-btn link-btn"
            :class="{ 'link-btn-on': Boolean(workflow.prerequisiteWorkflowId) }"
            type="button"
            :title="workflow.prerequisiteWorkflowId ? '修改前置工作流' : '关联前置工作流'"
            :aria-label="workflow.prerequisiteWorkflowId ? '修改前置工作流' : '关联前置工作流'"
            :disabled="isRunning(workflow.id)"
            @click="openLinkDialog(workflow)"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path
                fill="currentColor"
                d="M17 7h-3V5h3a5 5 0 0 1 0 10h-3v-2h3a3 3 0 0 0 0-6zM10 17H7a5 5 0 0 1 0-10h3v2H7a3 3 0 0 0 0 6h3v2zm-1-6h6v2H9v-2z"
              />
            </svg>
          </button>
          <button
            class="icon-btn play-btn"
            :class="{ 'play-btn-running': isRunning(workflow.id) }"
            type="button"
            :title="isRunning(workflow.id) ? '停止执行' : '运行'"
            :aria-label="isRunning(workflow.id) ? '停止执行' : '运行'"
            @click="isRunning(workflow.id) ? emit('stop', workflow.id) : emit('execute', workflow.id)"
          >
            <svg
              v-if="isRunning(workflow.id)"
              class="run-spinner"
              viewBox="0 0 24 24"
              width="16"
              height="16"
              aria-hidden="true"
            >
              <circle
                cx="12"
                cy="12"
                r="9"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-dasharray="40 20"
              />
            </svg>
            <svg v-else viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path fill="currentColor" d="M8 5v14l11-7z" />
            </svg>
          </button>
          <button
            class="icon-btn"
            type="button"
            title="删除"
            aria-label="删除"
            :disabled="isRunning(workflow.id)"
            @click="askRemoveOne(workflow.id, workflow.name)"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path
                fill="currentColor"
                d="M6 7h12v2H6V7zm2 3h8l-1 9H9L8 10zm3-5h2l1 2h3v2H7V7h3l1-2z"
              />
            </svg>
          </button>
        </div>
      </article>
    </div>

    <button class="new-workflow" type="button" @click="emit('create')">
      <span aria-hidden="true">+</span>
      新建工作流
    </button>

    <ConfirmDialog
      v-if="pending?.mode === 'one'"
      title="删除工作流"
      :message="`确定删除「${pending.name}」？此操作不可恢复。`"
      @cancel="dismiss"
      @confirm="confirmPending"
    />
    <ConfirmDialog
      v-else-if="pending?.mode === 'all'"
      title="全部删除"
      :message="`确定删除全部 ${pending.count} 个工作流？此操作不可恢复。`"
      confirm-label="全部删除"
      @cancel="dismiss"
      @confirm="confirmPending"
    />

    <div v-if="linkTarget" class="confirm-mask" role="dialog" aria-modal="true" @click.self="dismissLink">
      <section class="card rename-dialog">
        <strong>关联前置工作流</strong>
        <p class="hint">仅显示末路径与「{{ linkTarget.name }}」首路径相同的工作流。执行时会先跑前置任务。</p>
        <label class="field">
          前置工作流
          <select v-model="linkSelection" class="select">
            <option value="">无（不关联）</option>
            <option v-for="item in linkCandidates" :key="item.id" :value="item.id">
              {{ item.name }}{{ candidateHint(item) ? ` · ${candidateHint(item)}` : '' }}
            </option>
          </select>
        </label>
        <p v-if="linkCandidates.length === 0" class="muted">暂无路径匹配的可关联工作流。</p>
        <div class="row">
          <button class="secondary" type="button" @click="dismissLink">取消</button>
          <button type="button" @click="confirmLink">保存</button>
        </div>
      </section>
    </div>

    <div v-if="renameTarget" class="confirm-mask" role="dialog" aria-modal="true" @click.self="dismissRename">
      <section class="card rename-dialog">
        <strong>重命名工作流</strong>
        <label class="field">
          名称
          <input
            v-model="renameName"
            type="text"
            autocomplete="off"
            autofocus
            @keydown.enter.prevent="confirmRename"
          />
        </label>
        <p v-if="renameError" class="error">{{ renameError }}</p>
        <div class="row">
          <button class="secondary" type="button" @click="dismissRename">取消</button>
          <button type="button" :disabled="!renameName.trim()" @click="confirmRename">保存</button>
        </div>
      </section>
    </div>
  </section>
</template>
