<script setup lang="ts">
import { computed, onMounted, shallowRef, watch } from 'vue'
import {
  formatMmDd,
  localToday,
  localYesterday,
  monthNaturalWeeks,
  recentMonths,
  type NaturalWeek,
} from '@workcopilot/memory-engine'
import type { DailyJournal } from '../journalTypes'

const props = defineProps<{
  listJournals: (from: string, to: string) => Promise<DailyJournal[]>
}>()

const emit = defineEmits<{
  back: []
  openDay: [date: string]
}>()

const months = recentMonths(24)
const today = localToday()
const yesterday = localYesterday()
const dayBeforeYesterday = (() => {
  const d = new Date(`${today}T12:00:00`)
  d.setDate(d.getDate() - 2)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
})()

function relativeDayTag(date: string): string | null {
  if (date === today) return '今天'
  if (date === yesterday) return '昨天'
  if (date === dayBeforeYesterday) return '前天'
  return null
}
const selectedLabel = shallowRef(months[0]?.label ?? '')
const activeWeekIndex = shallowRef<number | null>(null)
const journals = shallowRef<DailyJournal[]>([])
const loading = shallowRef(false)
const error = shallowRef('')

const selectedMonth = computed(() =>
  months.find((item) => item.label === selectedLabel.value) ?? months[0] ?? null,
)

/** Weeks that have at least one day ≤ today. */
const weeksDesc = computed<NaturalWeek[]>(() => {
  const month = selectedMonth.value
  if (!month) return []
  return monthNaturalWeeks(month.year, month.month)
    .filter((week) => week.dates.some((date) => date <= today))
    .reverse()
})

const activeWeek = computed<NaturalWeek | null>(() => {
  const idx = activeWeekIndex.value
  if (idx != null) {
    return weeksDesc.value.find((week) => week.weekIndex === idx) ?? weeksDesc.value[0] ?? null
  }
  return weeksDesc.value[0] ?? null
})

const daysInWeek = computed(() => {
  const week = activeWeek.value
  if (!week) return []
  const set = new Set(journals.value.map((item) => item.date))
  return [...week.dates]
    .filter((date) => set.has(date) && date <= today)
    .sort((a, b) => b.localeCompare(a))
})

function itemCount(date: string): number {
  return journals.value.find((item) => item.date === date)?.items.length ?? 0
}

async function loadMonth() {
  const month = selectedMonth.value
  if (!month) return
  loading.value = true
  error.value = ''
  const from = `${month.year}-${String(month.month).padStart(2, '0')}-01`
  const last = new Date(month.year, month.month, 0).getDate()
  const to = `${month.year}-${String(month.month).padStart(2, '0')}-${String(last).padStart(2, '0')}`
  try {
    journals.value = await props.listJournals(from, to)
    activeWeekIndex.value = weeksDesc.value[0]?.weekIndex ?? null
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载失败'
  } finally {
    loading.value = false
  }
}

watch(selectedLabel, () => {
  void loadMonth()
})

watch(weeksDesc, (weeks) => {
  if (!weeks.some((week) => week.weekIndex === activeWeekIndex.value)) {
    activeWeekIndex.value = weeks[0]?.weekIndex ?? null
  }
})

onMounted(() => {
  void loadMonth()
})
</script>

<template>
  <section class="report-view">
    <div class="settings-bar">
      <button class="icon-btn" type="button" aria-label="返回" @click="emit('back')">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path fill="currentColor" d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
        </svg>
      </button>
      <strong>周报</strong>
      <button
        class="text-btn report-add-today"
        type="button"
        :title="`打开今日 ${formatMmDd(today)}`"
        @click="emit('openDay', today)"
      >
        添加当日日报
      </button>
    </div>

    <label class="field month-select-field">
      月份
      <select v-model="selectedLabel" class="month-select">
        <option v-for="item in months" :key="item.label" :value="item.label">
          {{ item.label }}
        </option>
      </select>
    </label>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="loading" class="hint">加载中…</p>

    <article v-else-if="selectedMonth" class="month-block">
      <header class="month-block-head">
        <h2>{{ selectedMonth.label }}</h2>
      </header>

      <div v-if="weeksDesc.length" class="week-layout">
        <aside class="week-tabs" :aria-label="`${selectedMonth.label} 自然周`">
          <button
            v-for="week in weeksDesc"
            :key="week.weekIndex"
            class="week-tab"
            type="button"
            :data-active="activeWeek?.weekIndex === week.weekIndex"
            @click="activeWeekIndex = week.weekIndex"
          >
            第{{ week.weekIndex }}周
            <span class="week-range">{{ formatMmDd(week.start) }}–{{ formatMmDd(week.end) }}</span>
          </button>
        </aside>

        <div class="day-panel">
          <h3 class="day-panel-title">
            第{{ activeWeek?.weekIndex }}周日报
          </h3>
          <ul v-if="daysInWeek.length" class="day-list">
            <li v-for="date in daysInWeek" :key="date">
              <button class="day-row" type="button" @click="emit('openDay', date)">
                <span class="day-label">{{ formatMmDd(date) }}</span>
                <span
                  v-if="relativeDayTag(date)"
                  class="day-tag"
                  :data-kind="relativeDayTag(date)"
                >{{ relativeDayTag(date) }}</span>
                <span class="day-meta">{{ itemCount(date) }} 项</span>
              </button>
            </li>
          </ul>
          <p v-else class="hint">本周暂无日报</p>
        </div>
      </div>
      <p v-else class="hint">该月暂无可展示的周</p>
    </article>
  </section>
</template>
