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

type SummarizeResult = {
  skipped: boolean
  reason?: string
  summary: string
  bullets: string[]
  raw: string
}

const props = defineProps<{
  listJournals: (from: string, to: string) => Promise<DailyJournal[]>
  summarizeJournals: (
    from: string,
    to: string,
    kind: 'monthly' | 'weekly' | 'range',
  ) => Promise<SummarizeResult>
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

const weeklyBusy = shallowRef(false)
const weeklyError = shallowRef('')
const weeklySummary = shallowRef('')
const weeklyBullets = shallowRef<string[]>([])

const monthlyBusy = shallowRef(false)
const monthlyError = shallowRef('')
const monthlySummary = shallowRef('')
const monthlyBullets = shallowRef<string[]>([])

const selectedMonth = computed(() =>
  months.find((item) => item.label === selectedLabel.value) ?? months[0] ?? null,
)

const monthRange = computed(() => {
  const month = selectedMonth.value
  if (!month) return null
  const from = `${month.year}-${String(month.month).padStart(2, '0')}-01`
  const last = new Date(month.year, month.month, 0).getDate()
  const to = `${month.year}-${String(month.month).padStart(2, '0')}-${String(last).padStart(2, '0')}`
  return { from, to }
})

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

const weekHasJournals = computed(() => daysInWeek.value.length > 0)

function itemCount(date: string): number {
  return journals.value.find((item) => item.date === date)?.items.length ?? 0
}

function resetWeekly() {
  weeklySummary.value = ''
  weeklyBullets.value = []
  weeklyError.value = ''
}

function resetMonthly() {
  monthlySummary.value = ''
  monthlyBullets.value = []
  monthlyError.value = ''
}

async function loadMonth() {
  const month = selectedMonth.value
  const range = monthRange.value
  if (!month || !range) return
  loading.value = true
  error.value = ''
  resetWeekly()
  resetMonthly()
  try {
    journals.value = await props.listJournals(range.from, range.to)
    activeWeekIndex.value = weeksDesc.value[0]?.weekIndex ?? null
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载失败'
  } finally {
    loading.value = false
  }
}

async function runWeeklySummary() {
  const week = activeWeek.value
  if (!week) return
  if (!weekHasJournals.value) {
    weeklyError.value = '本周暂无日报，无法生成周报'
    return
  }
  const from = week.start
  const to = week.dates.filter((date) => date <= today).sort().at(-1) ?? week.end
  weeklyBusy.value = true
  weeklyError.value = ''
  try {
    const result = await props.summarizeJournals(from, to, 'weekly')
    if (result.skipped) {
      weeklyError.value = result.summary || '暂无可总结内容'
      weeklySummary.value = ''
      weeklyBullets.value = []
    } else {
      weeklySummary.value = result.summary
      weeklyBullets.value = result.bullets
    }
  } catch (err) {
    weeklyError.value = err instanceof Error ? err.message : '周报生成失败'
  } finally {
    weeklyBusy.value = false
  }
}

async function runMonthlySummary() {
  const range = monthRange.value
  if (!range) return
  if (!journals.value.length) {
    monthlyError.value = '本月暂无日报，无法生成月报'
    return
  }
  monthlyBusy.value = true
  monthlyError.value = ''
  try {
    const result = await props.summarizeJournals(range.from, range.to, 'monthly')
    if (result.skipped) {
      monthlyError.value = result.summary || '暂无可总结内容'
      monthlySummary.value = ''
      monthlyBullets.value = []
    } else {
      monthlySummary.value = result.summary
      monthlyBullets.value = result.bullets
    }
  } catch (err) {
    monthlyError.value = err instanceof Error ? err.message : '月报生成失败'
  } finally {
    monthlyBusy.value = false
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

watch(activeWeekIndex, () => {
  resetWeekly()
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
      <strong>日报</strong>
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

      <section class="month-summary card">
        <div class="row summary-head">
          <strong>AI 汇总</strong>
          <div class="summary-btns">
            <button
              class="secondary"
              type="button"
              :disabled="weeklyBusy || !weekHasJournals"
              @click="runWeeklySummary"
            >
              {{ weeklyBusy ? '生成中…' : '生成周报' }}
            </button>
            <button
              class="secondary"
              type="button"
              :disabled="monthlyBusy || !journals.length"
              @click="runMonthlySummary"
            >
              {{ monthlyBusy ? '生成中…' : '生成月报' }}
            </button>
          </div>
        </div>
        <p class="hint">
          周报对应当前第{{ activeWeek?.weekIndex }}周
          <template v-if="activeWeek">
            （{{ formatMmDd(activeWeek.start) }}–{{ formatMmDd(activeWeek.end) }}）
          </template>
          ；月报对应整月日报。
        </p>

        <div v-if="weeklyError || weeklySummary || weeklyBullets.length" class="summary-block">
          <div class="summary-block-title">周报</div>
          <p v-if="weeklyError" class="error">{{ weeklyError }}</p>
          <template v-else>
            <p v-if="weeklySummary" class="ai-summary-text">{{ weeklySummary }}</p>
            <ul v-if="weeklyBullets.length">
              <li v-for="(bullet, index) in weeklyBullets" :key="`w-${index}`">{{ bullet }}</li>
            </ul>
          </template>
        </div>

        <div v-if="monthlyError || monthlySummary || monthlyBullets.length" class="summary-block">
          <div class="summary-block-title">月报</div>
          <p v-if="monthlyError" class="error">{{ monthlyError }}</p>
          <template v-else>
            <p v-if="monthlySummary" class="ai-summary-text">{{ monthlySummary }}</p>
            <ul v-if="monthlyBullets.length">
              <li v-for="(bullet, index) in monthlyBullets" :key="`m-${index}`">{{ bullet }}</li>
            </ul>
          </template>
        </div>
      </section>
    </article>
  </section>
</template>
