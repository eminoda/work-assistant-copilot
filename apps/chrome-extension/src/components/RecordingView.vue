<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, shallowRef, watch } from 'vue'
import type { RecordingEvent } from '@workcopilot/browser-recorder'
import SubPageHeader from './SubPageHeader.vue'

const props = defineProps<{
  active: boolean
  events: RecordingEvent[]
  paused: boolean
  extractArmed: boolean
  elapsedMs: number
}>()

const emit = defineEmits<{
  back: []
  close: []
  start: []
  pause: []
  resume: []
  wait: []
  armExtract: []
  cancel: []
  complete: []
}>()

const pendingExtract = shallowRef<{ text: string; url: string } | null>(null)
const extractLabel = shallowRef('')
const eventListEl = shallowRef<HTMLElement | null>(null)

const formattedTime = computed(() => {
  const total = Math.max(0, Math.floor(props.elapsedMs / 1000))
  const h = String(Math.floor(total / 3600)).padStart(2, '0')
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0')
  const s = String(total % 60).padStart(2, '0')
  return `${h}:${m}:${s}`
})

/** 入栈顺序：后发生的在上（栈顶），先发生的在下 */
const visibleEvents = computed(() =>
  [...props.events]
    .filter((event) => event.type !== 'cookies')
    .sort((left, right) => {
      const seqDelta = (right.seq ?? Number.MAX_SAFE_INTEGER) - (left.seq ?? Number.MAX_SAFE_INTEGER)
      if (seqDelta !== 0) return seqDelta
      return right.timestamp.localeCompare(left.timestamp)
    }),
)

watch(
  () => visibleEvents.value.length,
  async () => {
    await nextTick()
    const el = eventListEl.value
    if (el) el.scrollTop = 0
  },
)

function titleFor(event: RecordingEvent) {
  switch (event.type) {
    case 'navigation':
      return '打开页面'
    case 'tab':
      return event.tabAction === 'activated' ? '切换标签页' : event.tabAction === 'created' ? '新建标签页' : '关闭标签页'
    case 'input':
      return event.credentialKey ? '输入密码' : '输入内容'
    case 'click':
      return event.element?.selector.text
        ? `点击「${event.element.selector.text}」`
        : '点击元素'
    case 'submit':
      return '提交表单'
    case 'waitNavigation':
      return '等待跳转'
    case 'extract':
      return event.extractLabel ? `提取：${event.extractLabel}` : '文字提取'
    default:
      return event.type
  }
}

function detailFor(event: RecordingEvent) {
  if (event.type === 'waitNavigation') {
    const timeout = Math.round((event.waitTimeoutMs ?? 90_000) / 1000)
    if (event.expectedUrl) return `已捕获 → ${event.expectedUrl}（超时 ${timeout}s）`
    return `等待 URL 变化 · 超时 ${timeout}s · 基准 ${event.fromUrl || event.url}`
  }
  if (event.type === 'extract') return event.extractText || event.value || ''
  if (event.type === 'input') {
    const sel = event.element?.selector
    return sel?.stableAttribute
      ? `${sel.stableAttribute.name}=${sel.stableAttribute.value}`
      : sel?.placeholder || sel?.css || event.url
  }
  if (event.type === 'click' || event.type === 'submit') {
    const sel = event.element?.selector
    return sel?.stableAttribute
      ? `${sel.stableAttribute.name}=${sel.stableAttribute.value}`
      : sel?.role || sel?.text || event.url
  }
  return event.url
}

function onMessage(message: {
  type?: string
  text?: string
  url?: string
  events?: RecordingEvent[]
}) {
  if (message.type === 'recorder.extractPending' && message.text && message.url) {
    pendingExtract.value = { text: message.text, url: message.url }
    extractLabel.value = message.text.slice(0, 24)
  }
}

async function confirmExtract() {
  const pending = pendingExtract.value
  const label = extractLabel.value.trim()
  if (!pending || !label) return
  await chrome.runtime.sendMessage({
    type: 'recorder.confirmExtract',
    label,
    text: pending.text,
    url: pending.url,
  })
  pendingExtract.value = null
  extractLabel.value = ''
}

function dismissExtract() {
  pendingExtract.value = null
  extractLabel.value = ''
  void chrome.runtime.sendMessage({ type: 'recorder.armExtract', armed: false })
}

onMounted(() => {
  chrome.runtime.onMessage.addListener(onMessage)
})

onUnmounted(() => {
  chrome.runtime.onMessage.removeListener(onMessage)
})
</script>

<template>
  <section class="sub-page recording-page">
    <SubPageHeader
      :title="active ? '录制中' : '录制'"
      @back="emit('back')"
      @close="emit('close')"
    />

    <div class="record-deck" :data-paused="paused || !active" :data-idle="!active">
      <div class="deck-left">
        <span class="rec-dot" :data-paused="paused || !active" aria-hidden="true" />
        <span class="rec-time">{{ formattedTime }}</span>
        <span v-if="!active" class="rec-idle-hint">未开始</span>
      </div>
      <div class="deck-controls">
        <button
          v-if="!active"
          class="deck-btn deck-start"
          type="button"
          title="开始录制"
          aria-label="开始录制"
          @click="emit('start')"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path fill="currentColor" d="M8 5v14l11-7z" />
          </svg>
        </button>
        <button
          v-else-if="!paused"
          class="deck-btn"
          type="button"
          title="暂停"
          aria-label="暂停"
          @click="emit('pause')"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path fill="currentColor" d="M7 5h3v14H7zm7 0h3v14h-3z" />
          </svg>
        </button>
        <button
          v-else
          class="deck-btn"
          type="button"
          title="继续"
          aria-label="继续"
          @click="emit('resume')"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path fill="currentColor" d="M8 5v14l11-7z" />
          </svg>
        </button>
        <button
          class="deck-btn deck-stop"
          type="button"
          title="完成录制"
          aria-label="完成录制"
          :disabled="!active"
          @click="emit('complete')"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
          </svg>
        </button>
      </div>
    </div>

    <div class="record-body">
      <div ref="eventListEl" class="event-list">
        <p v-if="!active" class="muted empty">点击播放键开始录制，之后的页面操作会出现在这里。</p>
        <p v-else-if="visibleEvents.length === 0" class="muted empty">开始操作页面后，事件会显示在这里。</p>
        <article v-for="(event, index) in visibleEvents" :key="event.id" class="event-row">
          <span class="event-index">{{ event.seq ?? visibleEvents.length - index }}</span>
          <div class="event-meta">
            <b>{{ titleFor(event) }}</b>
            <small>{{ detailFor(event) }}</small>
          </div>
        </article>
      </div>

      <aside class="record-tools">
        <button
          class="tool-btn"
          type="button"
          title="等待跳转（二维码/短信等）"
          :disabled="!active"
          @click="emit('wait')"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path fill="currentColor" d="M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16zm1 4h-2v5l4 2 .9-1.6-2.9-1.5V8z" />
          </svg>
          <span>等待跳转</span>
        </button>
        <button
          class="tool-btn"
          type="button"
          :data-on="extractArmed"
          title="文字提取（用于通知）"
          :disabled="!active"
          @click="emit('armExtract')"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path fill="currentColor" d="M4 4h16v2H4V4zm2 4h12v2H6V8zm-2 4h16v2H4v-2zm2 4h10v2H6v-2z" />
          </svg>
          <span>{{ extractArmed ? '选择文字中' : '文字提取' }}</span>
        </button>
      </aside>
    </div>

    <div v-if="pendingExtract" class="extract-dialog card">
      <strong>命名提取文字</strong>
      <p class="hint">「{{ pendingExtract.text.slice(0, 80) }}」</p>
      <label class="field">
        名称（用于通知监听）
        <input v-model="extractLabel" type="text" placeholder="例如：Bug 标题" @keydown.enter.prevent="confirmExtract" />
      </label>
      <div class="row">
        <button class="secondary" type="button" @click="dismissExtract">取消</button>
        <button type="button" :disabled="!extractLabel.trim()" @click="confirmExtract">保存</button>
      </div>
    </div>

    <footer class="record-footer">
      <button class="secondary footer-btn" type="button" @click="emit('cancel')">取消录制</button>
      <button class="footer-btn" type="button" :disabled="!active" @click="emit('complete')">完成录制</button>
    </footer>
  </section>
</template>
