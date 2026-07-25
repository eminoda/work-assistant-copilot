<script setup lang="ts">
import { computed, onMounted, onUnmounted, shallowRef } from 'vue'
import SubPageHeader from './SubPageHeader.vue'

export type NotifyMessage = {
  id: string
  title: string
  tag: string
  label: string
  value: string
  previousValue?: string | null
  workflowId?: string | null
  unread: boolean
  updatedAt: string
  createdAt: string
}

export type NotifySchedule = {
  id: string
  workflowId: string
  intervalMinutes: number
  enabled: boolean
  nextRunAt?: string | null
  lastRunAt?: string | null
}

const props = defineProps<{
  messages: NotifyMessage[]
  schedules: NotifySchedule[]
  workflows: Array<{ id: string; name: string }>
  loading?: boolean
}>()

const emit = defineEmits<{
  back: []
  close: []
  refresh: []
  read: [id: string]
  readAll: []
  createSchedule: [payload: { workflowId: string; intervalMinutes: number }]
  toggleSchedule: [payload: { id: string; enabled: boolean }]
  removeSchedule: [id: string]
  runWorkflow: [workflowId: string]
}>()

const tab = shallowRef<'messages' | 'schedules'>('messages')
const scheduleWorkflowId = shallowRef('')
const scheduleMinutes = shallowRef(60)

const sortedMessages = computed(() =>
  [...props.messages].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
)

function formatTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function workflowName(id: string) {
  return props.workflows.find((item) => item.id === id)?.name || id
}

function submitSchedule() {
  if (!scheduleWorkflowId.value) return
  emit('createSchedule', {
    workflowId: scheduleWorkflowId.value,
    intervalMinutes: Math.max(1, Number(scheduleMinutes.value) || 60),
  })
}
</script>

<template>
  <section class="sub-page notify-page">
    <SubPageHeader title="消息中心" @back="emit('back')" @close="emit('close')" />

    <div class="notify-tabs">
      <button type="button" :data-on="tab === 'messages'" @click="tab = 'messages'">消息</button>
      <button type="button" :data-on="tab === 'schedules'" @click="tab = 'schedules'">定时任务</button>
      <button class="text-btn" type="button" @click="emit('refresh')">刷新</button>
    </div>

    <template v-if="tab === 'messages'">
      <div class="row panel-head">
        <strong>抓取结果</strong>
        <button
          v-if="sortedMessages.some((item) => item.unread)"
          class="text-btn"
          type="button"
          @click="emit('readAll')"
        >
          全部已读
        </button>
      </div>
      <p v-if="loading" class="muted empty">加载中…</p>
      <p v-else-if="sortedMessages.length === 0" class="muted empty">暂无消息。执行含信息抓取的工作流后会出现在这里。</p>
      <article
        v-for="item in sortedMessages"
        :key="item.id"
        class="notify-item"
        :data-unread="item.unread"
        @click="emit('read', item.id)"
      >
        <div class="notify-item-head">
          <b>{{ item.title }}</b>
          <span class="kind-badge">{{ item.tag || 'workflow' }}</span>
        </div>
        <small v-if="item.label" class="notify-label">{{ item.label }}</small>
        <p class="notify-value">{{ item.value }}</p>
        <small class="workflow-time">{{ formatTime(item.updatedAt) }}</small>
      </article>
    </template>

    <template v-else>
      <div class="card schedule-form">
        <strong>新增定时抓取</strong>
        <label class="field">
          工作流
          <select v-model="scheduleWorkflowId">
            <option value="" disabled>选择工作流</option>
            <option v-for="workflow in workflows" :key="workflow.id" :value="workflow.id">
              {{ workflow.name }}
            </option>
          </select>
        </label>
        <label class="field">
          间隔（分钟）
          <input v-model.number="scheduleMinutes" type="number" min="1" max="1440" />
        </label>
        <button type="button" :disabled="!scheduleWorkflowId" @click="submitSchedule">添加</button>
      </div>

      <p v-if="schedules.length === 0" class="muted empty">暂无定时任务。</p>
      <article v-for="item in schedules" :key="item.id" class="notify-item">
        <div class="notify-item-head">
          <b>{{ workflowName(item.workflowId) }}</b>
          <span class="kind-badge">每 {{ item.intervalMinutes }} 分钟</span>
        </div>
        <small class="workflow-time">
          下次 {{ item.nextRunAt ? formatTime(item.nextRunAt) : '—' }}
        </small>
        <div class="actions" style="margin-top: 8px">
          <button class="secondary" type="button" @click="emit('runWorkflow', item.workflowId)">立即执行</button>
          <button
            class="secondary"
            type="button"
            @click="emit('toggleSchedule', { id: item.id, enabled: !item.enabled })"
          >
            {{ item.enabled ? '停用' : '启用' }}
          </button>
          <button class="secondary" type="button" @click="emit('removeSchedule', item.id)">删除</button>
        </div>
      </article>
    </template>
  </section>
</template>
