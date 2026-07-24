<script setup lang="ts">
import { computed } from 'vue'
import SubPageHeader from './SubPageHeader.vue'
import { formatWorkflowTime, type WorkflowSummary } from '../workflowTypes'

const props = defineProps<{
  workflow: WorkflowSummary
  loading?: boolean
  error?: string
}>()

const emit = defineEmits<{
  back: []
  close: []
  execute: [id: string]
  remove: [id: string]
}>()

const kindLabel = computed(() => {
  if (props.workflow.kind === 'login' || props.workflow.intent?.includes('login')) return '登录'
  return '应用'
})

function stepTitle(tool: string) {
  switch (tool) {
    case 'browser.open':
      return '打开页面'
    case 'browser.click':
      return '点击'
    case 'browser.input':
      return '输入'
    case 'browser.setCookies':
      return '注入 Cookie'
    case 'browser.waitNavigation':
      return '等待跳转'
    case 'browser.extract':
      return '提取'
    case 'browser.snapshot':
      return '快照'
    default:
      return tool
  }
}

function stepDetail(step: NonNullable<WorkflowSummary['steps']>[number]) {
  const params = step.params || {}
  if (typeof params.url === 'string') return params.url
  if (typeof params.credentialKey === 'string') return `credential: ${params.credentialKey}`
  if (typeof params.fromUrl === 'string') {
    return params.expectedUrl
      ? `${params.fromUrl} → ${params.expectedUrl}`
      : `等待离开 ${params.fromUrl}`
  }
  const target = params.target as Record<string, unknown> | undefined
  if (target && typeof target === 'object') {
    if (target.text) return String(target.text)
    if (target.placeholder) return String(target.placeholder)
    if (target.ariaLabel) return String(target.ariaLabel)
    const stable = target.stableAttribute as { name?: string; value?: string } | undefined
    if (stable?.name && stable.value) return `${stable.name}=${stable.value}`
    if (target.css) return String(target.css)
    const parents = target.parents as Array<{ css?: string; tag?: string }> | undefined
    if (parents?.length) {
      const trail = parents
        .map((parent) => parent.css || parent.tag)
        .filter(Boolean)
        .reverse()
        .join(' › ')
      if (trail) return `${trail} › …`
    }
  }
  if (typeof params.value === 'string') return params.value
  try {
    return JSON.stringify(params)
  } catch {
    return step.tool
  }
}
</script>

<template>
  <section class="sub-page workflow-detail">
    <SubPageHeader title="工作流详情" @back="emit('back')" @close="emit('close')" />

    <p v-if="loading" class="muted">加载中…</p>
    <p v-else-if="error" class="error">{{ error }}</p>

    <template v-else>
      <div class="card detail-summary">
        <div class="workflow-title">
          <b>{{ workflow.name }}</b>
          <span class="kind-badge">{{ kindLabel }}</span>
        </div>
        <p class="hint">{{ workflow.description || workflow.intent }}</p>
        <dl class="detail-meta">
          <div>
            <dt>类型</dt>
            <dd>{{ kindLabel }}</dd>
          </div>
          <div>
            <dt>Intent</dt>
            <dd>{{ workflow.intent }}</dd>
          </div>
          <div v-if="workflow.homeUrl">
            <dt>主页</dt>
            <dd class="break">{{ workflow.homeUrl }}</dd>
          </div>
          <div v-if="formatWorkflowTime(workflow.createdAt)">
            <dt>创建时间</dt>
            <dd>{{ formatWorkflowTime(workflow.createdAt) }}</dd>
          </div>
          <div v-if="formatWorkflowTime(workflow.updatedAt)">
            <dt>更新时间</dt>
            <dd>{{ formatWorkflowTime(workflow.updatedAt) }}</dd>
          </div>
          <div>
            <dt>步骤数</dt>
            <dd>{{ workflow.steps?.length ?? 0 }}</dd>
          </div>
        </dl>
        <div class="row">
          <button class="secondary" type="button" @click="emit('remove', workflow.id)">删除</button>
          <button type="button" @click="emit('execute', workflow.id)">运行</button>
        </div>
      </div>

      <section class="detail-steps">
        <div class="row panel-head">
          <strong>步骤</strong>
        </div>
        <div class="workflow-card">
          <p v-if="!workflow.steps?.length" class="muted empty">暂无步骤</p>
          <article
            v-for="(step, index) in workflow.steps || []"
            :key="step.id"
            class="event-row"
          >
            <span class="event-index">{{ index + 1 }}</span>
            <div class="event-meta">
              <b>{{ stepTitle(step.tool) }}</b>
              <small>{{ stepDetail(step) }}</small>
              <small class="step-tool">{{ step.tool }}</small>
            </div>
          </article>
        </div>
      </section>
    </template>
  </section>
</template>
