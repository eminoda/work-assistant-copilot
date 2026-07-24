<script setup lang="ts">
import { shallowRef } from 'vue'
import ConfirmDialog from './ConfirmDialog.vue'
import { formatWorkflowTime } from '../workflowTypes'

const props = defineProps<{
  workflows: Array<{
    id: string
    name: string
    intent: string
    kind?: string
    homeUrl?: string
    createdAt?: string
    updatedAt?: string
  }>
  runningIds?: string[]
}>()
const emit = defineEmits<{
  execute: [id: string]
  stop: [id: string]
  remove: [id: string]
  removeAll: []
  create: []
  open: [id: string]
}>()

const pending = shallowRef<null | { mode: 'one'; id: string; name: string } | { mode: 'all'; count: number }>(null)

function kindLabel(kind?: string, intent?: string) {
  if (kind === 'login' || intent?.includes('login')) return '登录'
  return '应用'
}

function timeLabel(workflow: { createdAt?: string; updatedAt?: string }) {
  const stamp = formatWorkflowTime(workflow.updatedAt || workflow.createdAt)
  return stamp ? `更新于 ${stamp}` : ''
}

function isRunning(id: string) {
  return Boolean(props.runningIds?.includes(id))
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
            <span class="kind-badge">{{ kindLabel(workflow.kind, workflow.intent) }}</span>
          </div>
          <small v-if="timeLabel(workflow)" class="workflow-time">{{ timeLabel(workflow) }}</small>
          <small>{{ workflow.homeUrl || workflow.intent }}</small>
        </div>
        <div class="actions" @click.stop>
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
  </section>
</template>
