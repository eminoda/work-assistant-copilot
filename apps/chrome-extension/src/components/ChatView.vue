<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef, watch } from 'vue'
import { marked } from 'marked'
import SubPageHeader from './SubPageHeader.vue'
import {
  classifyChatIntent,
  unsupportedReply,
  type ChatNavigateTarget,
} from '../chatIntent'

export type ChatApiResult = {
  message: string
  skillCalls?: Array<{ name: string; args?: unknown; input?: unknown }>
}

type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  pending?: boolean
  unsupported?: boolean
  skillCalls?: Array<{ name: string }>
  navigateTip?: {
    target: ChatNavigateTarget
    label: string
    tip: string
  }
}

const props = defineProps<{
  chat: (message: string) => Promise<ChatApiResult>
  connected: boolean
}>()

const emit = defineEmits<{
  back: []
  close: []
  navigate: [target: ChatNavigateTarget]
}>()

const draft = shallowRef('')
const sending = shallowRef(false)
const messages = shallowRef<ChatMessage[]>([])
const threadEl = ref<HTMLElement | null>(null)

let seq = 0
function nextId() {
  seq += 1
  return `m-${Date.now()}-${seq}`
}

const SUGGESTIONS = [
  { label: '总结今日工作', text: '帮我总结今天的工作' },
  { label: '查看工作流', text: '列出已保存的工作流' },
  { label: '未读消息', text: '有没有未读消息' },
  { label: '开始录制', text: '开始录制' },
] as const

const canSend = computed(() => Boolean(draft.value.trim()) && !sending.value)

function renderMarkdown(text: string) {
  return marked.parse(text, { async: false }) as string
}

async function scrollToBottom() {
  await nextTick()
  const el = threadEl.value
  if (el) el.scrollTop = el.scrollHeight
}

watch(messages, () => void scrollToBottom(), { deep: true })

function pushMessage(message: ChatMessage) {
  messages.value = [...messages.value, message]
}

function replaceMessage(id: string, patch: Partial<ChatMessage>) {
  messages.value = messages.value.map((item) =>
    item.id === id ? { ...item, ...patch } : item,
  )
}

async function sendText(raw: string) {
  const text = raw.trim()
  if (!text || sending.value) return

  draft.value = ''
  pushMessage({ id: nextId(), role: 'user', text })

  const intent = classifyChatIntent(text)

  if (intent.kind === 'unsupported') {
    pushMessage({
      id: nextId(),
      role: 'assistant',
      text: unsupportedReply(),
      unsupported: true,
    })
    return
  }

  if (intent.kind === 'navigate') {
    pushMessage({
      id: nextId(),
      role: 'assistant',
      text: intent.tip,
      navigateTip: {
        target: intent.target,
        label: intent.label,
        tip: intent.tip,
      },
    })
    return
  }

  if (!props.connected) {
    pushMessage({
      id: nextId(),
      role: 'assistant',
      text: '尚未连接本地 Runtime。请先在设置中填写 Token 并连接。',
    })
    return
  }

  const pendingId = nextId()
  sending.value = true
  pushMessage({
    id: pendingId,
    role: 'assistant',
    text: '正在思考…',
    pending: true,
  })

  try {
    const result = await props.chat(text)
    replaceMessage(pendingId, {
      text: result.message || '（无回复）',
      pending: false,
      skillCalls: (result.skillCalls || []).map((call) => ({ name: call.name })),
    })
  } catch (error) {
    replaceMessage(pendingId, {
      text: error instanceof Error ? error.message : '请求失败',
      pending: false,
    })
  } finally {
    sending.value = false
  }
}

function onSubmit() {
  void sendText(draft.value)
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    void sendText(draft.value)
  }
}

function confirmNavigate(target: ChatNavigateTarget) {
  emit('navigate', target)
}

function dismissNavigate(id: string) {
  messages.value = messages.value.map((item) => {
    if (item.id !== id || !item.navigateTip) return item
    const { navigateTip, ...rest } = item
    return {
      ...rest,
      text: `已取消跳转到「${navigateTip.label}」。如需其它帮助，请继续提问。`,
    }
  })
}

function useSuggestion(text: string) {
  void sendText(text)
}

onMounted(() => void scrollToBottom())
</script>

<template>
  <section class="sub-page chat-page">
    <SubPageHeader title="AI 聊天" @back="emit('back')" @close="emit('close')" />

    <div ref="threadEl" class="chat-thread" role="log" aria-live="polite">
      <div v-if="messages.length === 0" class="chat-empty">
        <div class="chat-empty-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="26" height="26">
            <path
              fill="currentColor"
              d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.2L4 17.2V4h16v12z"
            />
          </svg>
        </div>
        <strong>今天想处理哪件事？</strong>
        <p class="hint">
          可询问日报、工作流与消息；录制 / 提取等会引导你打开对应页面。
        </p>
        <div class="chat-suggestions">
          <button
            v-for="item in SUGGESTIONS"
            :key="item.label"
            type="button"
            class="chat-chip"
            @click="useSuggestion(item.text)"
          >
            {{ item.label }}
          </button>
        </div>
      </div>

      <article
        v-for="item in messages"
        :key="item.id"
        class="chat-bubble"
        :data-role="item.role"
        :data-pending="item.pending || undefined"
        :data-unsupported="item.unsupported || undefined"
      >
        <div class="chat-bubble-meta">
          {{ item.role === 'user' ? '你' : 'WorkCopilot' }}
        </div>

        <div
          v-if="item.role === 'assistant' && !item.pending && !item.navigateTip"
          class="chat-bubble-body md-body"
          v-html="renderMarkdown(item.text)"
        />
        <div v-else class="chat-bubble-body chat-bubble-plain">{{ item.text }}</div>

        <div v-if="item.skillCalls?.length" class="chat-skills">
          <span
            v-for="(call, index) in item.skillCalls"
            :key="`${item.id}-${call.name}-${index}`"
            class="chat-skill-tag"
          >
            {{ call.name }}
          </span>
        </div>

        <div v-if="item.navigateTip" class="chat-nav-tip">
          <p class="hint">二次确认：离开聊天并打开「{{ item.navigateTip.label }}」？</p>
          <div class="row chat-nav-actions">
            <button class="secondary" type="button" @click="dismissNavigate(item.id)">
              留在聊天
            </button>
            <button type="button" @click="confirmNavigate(item.navigateTip.target)">
              前往{{ item.navigateTip.label }}
            </button>
          </div>
        </div>
      </article>
    </div>

    <div class="chat-composer-dock">
      <form class="chat-composer" @submit.prevent="onSubmit">
        <textarea
          v-model="draft"
          rows="2"
          placeholder="询问日报、工作流、消息… Enter 发送，Shift+Enter 换行"
          :disabled="sending"
          @keydown="onKeydown"
        />
        <button type="submit" :disabled="!canSend" aria-label="发送">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path fill="currentColor" d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        </button>
      </form>
    </div>
  </section>
</template>
