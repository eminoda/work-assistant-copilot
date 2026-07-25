<script setup lang="ts">
import { computed, onMounted, shallowRef } from 'vue'
import { marked } from 'marked'
import { formatMmDd } from '@workcopilot/memory-engine'
import type { DailyJournal } from '../journalTypes'

const props = defineProps<{
  date: string
  getJournal: (date: string) => Promise<DailyJournal>
}>()

const emit = defineEmits<{ back: [] }>()

const raw = shallowRef('')
const loading = shallowRef(false)
const error = shallowRef('')

const html = computed(() => {
  if (!raw.value.trim()) return '<p class="md-empty">暂无原数据</p>'
  return marked.parse(raw.value, { async: false }) as string
})

onMounted(async () => {
  loading.value = true
  try {
    const journal = await props.getJournal(props.date)
    raw.value = journal.rawMarkdown || ''
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载失败'
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <section class="daily-raw">
    <div class="settings-bar">
      <button class="icon-btn" type="button" aria-label="返回" @click="emit('back')">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path fill="currentColor" d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
        </svg>
      </button>
      <strong>{{ formatMmDd(date) }} · 原数据</strong>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="loading" class="hint">加载中…</p>
    <article v-else class="md-body" v-html="html" />
  </section>
</template>
