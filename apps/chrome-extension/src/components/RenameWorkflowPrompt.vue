<script setup lang="ts">
import { computed, reactive, shallowRef, watch } from 'vue'
import { canLinkPrerequisite, workflowExitUrl } from '../workflowLink'
import type { WorkflowSummary } from '../workflowTypes'

export type WorkflowKindOption = 'login' | 'app'

const props = defineProps<{
  defaultName: string
  credentialKeys?: string[]
  error?: string
  saving?: boolean
  workflows?: WorkflowSummary[]
  entryUrl?: string
}>()

const emit = defineEmits<{
  save: [payload: {
    name: string
    kind: WorkflowKindOption
    credentials: Record<string, string>
    prerequisiteWorkflowId?: string
  }]
  cancel: []
}>()

const name = shallowRef(props.defaultName)
const kind = shallowRef<WorkflowKindOption>('login')
const prerequisiteWorkflowId = shallowRef('')
const passwords = reactive<Record<string, string>>({})

const keys = computed(() => props.credentialKeys ?? [])

const prerequisiteOptions = computed(() => {
  const list = props.workflows ?? []
  const entryUrl = props.entryUrl
  if (!entryUrl) return []
  return list.filter((workflow) => canLinkPrerequisite(
    {
      homeUrl: workflow.homeUrl,
      steps: (workflow.steps || []).map((step) => ({
        id: step.id || 'x',
        tool: step.tool,
        params: { ...step.params },
        timeoutMs: 30_000,
        retries: 0,
        requiresConfirmation: false,
      })),
    },
    { entryUrl },
  ))
})

watch(
  () => props.defaultName,
  (value) => {
    name.value = value
  },
  { immediate: true },
)

watch(
  keys,
  (next) => {
    for (const key of Object.keys(passwords)) delete passwords[key]
    for (const key of next) passwords[key] = ''
  },
  { immediate: true },
)

watch(
  prerequisiteOptions,
  (options) => {
    if (!options.some((item) => item.id === prerequisiteWorkflowId.value)) {
      prerequisiteWorkflowId.value = ''
    }
  },
  { immediate: true },
)

const canSubmit = computed(() => {
  if (!name.value.trim()) return false
  return keys.value.every((key) => Boolean(passwords[key]?.trim()))
})

function shortKey(key: string) {
  const parts = key.split('.')
  return parts[parts.length - 1] === 'password'
    ? parts.slice(0, -1).join('.') || key
    : key
}

function optionHint(workflow: WorkflowSummary) {
  const exit = workflowExitUrl({
    homeUrl: workflow.homeUrl,
    steps: (workflow.steps || []).map((step) => ({
      id: step.id || 'x',
      tool: step.tool,
      params: { ...step.params },
      timeoutMs: 30_000,
      retries: 0,
      requiresConfirmation: false,
    })),
  })
  return exit || workflow.homeUrl || ''
}

function submit() {
  if (!canSubmit.value) return
  emit('save', {
    name: name.value.trim(),
    kind: kind.value,
    credentials: Object.fromEntries(
      keys.value.map((key) => [key, passwords[key]!.trim()]),
    ),
    ...(prerequisiteWorkflowId.value
      ? { prerequisiteWorkflowId: prerequisiteWorkflowId.value }
      : {}),
  })
}
</script>

<template>
  <div class="confirm-mask" role="dialog" aria-modal="true">
    <section class="card rename-dialog save-workflow-dialog">
      <strong>保存工作流</strong>
      <p class="muted">填写名称与分类后保存。登录类型会保存停录时的完整 Cookie 会话；下次先注入停录页做预登录，未跳转则跳过完整流程。</p>

      <label class="field">
        工作流名称
        <input
          v-model="name"
          type="text"
          autocomplete="off"
          placeholder="例如：登录公司系统"
          :disabled="saving"
        />
      </label>
      <p v-if="error" class="error">{{ error }}</p>

      <label class="field">
        分类
        <select v-model="kind" class="select">
          <option value="login">登录</option>
          <option value="app">应用</option>
        </select>
      </label>

      <label class="field">
        前置工作流
        <select v-model="prerequisiteWorkflowId" class="select" :disabled="saving">
          <option value="">无（不关联）</option>
          <option
            v-for="workflow in prerequisiteOptions"
            :key="workflow.id"
            :value="workflow.id"
          >
            {{ workflow.name }}{{ optionHint(workflow) ? ` · ${optionHint(workflow)}` : '' }}
          </option>
        </select>
      </label>
      <p class="hint">
        仅列出末路径与当前录制首路径相同的工作流。执行时会先跑前置任务。
      </p>

      <div v-if="keys.length" class="password-block">
        <strong class="password-title">填写密码</strong>
        <p class="hint">
          录制时浏览器不会把密码交给插件，因此录音里只有密码占位符，不含明文。
          请在此本地再输入一次，仅保存在本机 credential，供回放自动填入；不会写入工作流步骤。
        </p>
        <label v-for="key in keys" :key="key" class="field">
          {{ shortKey(key) }}
          <input
            v-model="passwords[key]"
            type="password"
            autocomplete="new-password"
            :placeholder="key"
          />
        </label>
      </div>

      <div class="row">
        <button class="secondary" type="button" :disabled="saving" @click="emit('cancel')">丢弃</button>
        <button type="button" :disabled="!canSubmit || saving" @click="submit">
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </div>
    </section>
  </div>
</template>
