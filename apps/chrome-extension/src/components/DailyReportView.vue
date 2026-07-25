<script setup lang="ts">
import { computed, onMounted, shallowRef, watch } from 'vue'
import { marked } from 'marked'
import {
  buildJournalDisplayMarkdown,
  formatMmDd,
  journalNeedsAi,
} from '@workcopilot/memory-engine'
import type { DailyJournal } from '../journalTypes'

const props = defineProps<{
  date: string
  getJournal: (date: string) => Promise<DailyJournal>
  addItem: (date: string, title: string, description: string) => Promise<DailyJournal>
  analyzeDay: (date: string) => Promise<{
    skipped: boolean
    reason?: string | null
    cached?: boolean
    markdown: string
    journal: DailyJournal
  }>
}>()

const emit = defineEmits<{
  back: []
  openRaw: []
}>()

const journal = shallowRef<DailyJournal | null>(null)
const loading = shallowRef(false)
const error = shallowRef('')
const title = shallowRef('')
const description = shallowRef('')
const saving = shallowRef(false)
const showForm = shallowRef(false)
const aiBusy = shallowRef(false)
const aiError = shallowRef('')

const heading = computed(() => formatMmDd(props.date))

const displayMarkdown = computed(() => {
  if (!journal.value) return ''
  return buildJournalDisplayMarkdown(journal.value)
})

const displayHtml = computed(() => {
  const md = displayMarkdown.value
  if (!md.trim()) return ''
  return marked.parse(md, { async: false }) as string
})

function emptyJournal(date: string): DailyJournal {
  return {
    id: '',
    date,
    items: [],
    rawMarkdown: '',
    contentHash: '',
    aiMarkdown: '',
    aiContentHash: '',
    createdAt: '',
    updatedAt: '',
  }
}

async function ensureAiIfNeeded() {
  if (!journal.value || !journalNeedsAi(journal.value)) return
  aiBusy.value = true
  aiError.value = ''
  try {
    const result = await props.analyzeDay(props.date)
    journal.value = result.journal
  } catch (err) {
    aiError.value = err instanceof Error ? err.message : 'AI 分析失败'
  } finally {
    aiBusy.value = false
  }
}

async function reload() {
  loading.value = true
  error.value = ''
  aiError.value = ''
  try {
    journal.value = await props.getJournal(props.date)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/not found/i.test(message)) {
      journal.value = emptyJournal(props.date)
    } else {
      error.value = message
      journal.value = null
    }
  } finally {
    loading.value = false
  }
  await ensureAiIfNeeded()
}

async function onAdd() {
  if (!title.value.trim() || !description.value.trim()) return
  saving.value = true
  error.value = ''
  try {
    journal.value = await props.addItem(props.date, title.value.trim(), description.value.trim())
    description.value = ''
    showForm.value = false
  } catch (err) {
    error.value = err instanceof Error ? err.message : '保存失败'
  } finally {
    saving.value = false
  }
}

watch(() => props.date, () => {
  void reload()
})

onMounted(() => {
  void reload()
})
</script>

<template>
  <section class="daily-report">
    <div class="settings-bar">
      <button class="icon-btn" type="button" aria-label="返回" @click="emit('back')">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path fill="currentColor" d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
        </svg>
      </button>
      <strong>{{ heading }} · 日报</strong>
      <button class="text-btn" type="button" @click="emit('openRaw')">查看原数据</button>
    </div>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="loading" class="hint">加载中…</p>

    <article v-else class="daily-body">
      <p v-if="aiBusy" class="hint">检测到 Git 变更，正在生成 AI 日报…</p>
      <p v-else-if="aiError" class="error">{{ aiError }}</p>

      <div v-if="displayHtml" class="md-body daily-md" v-html="displayHtml" />
      <p v-else-if="!aiBusy" class="hint">暂无内容，可手动新增或等待 Git 扫描。</p>

      <div class="daily-actions">
        <button class="secondary" type="button" @click="showForm = !showForm">
          {{ showForm ? '取消' : '新增事项' }}
        </button>
      </div>

      <form v-if="showForm" class="card add-form" @submit.prevent="onAdd">
        <label class="field">
          事项
          <input v-model="title" placeholder="例如：项目名 / 会议" />
        </label>
        <label class="field">
          描述
          <textarea v-model="description" rows="3" placeholder="今天完成了什么" />
        </label>
        <button class="secondary" type="submit" :disabled="saving">
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </form>
    </article>
  </section>
</template>
