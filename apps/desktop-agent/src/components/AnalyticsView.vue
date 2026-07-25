<script setup lang="ts">
import { computed, onMounted, shallowRef } from 'vue'
import type { UsageDay } from '../composables/useRuntimeClient'

const props = defineProps<{
  connected: boolean
  listUsage: (days?: number) => Promise<{ days: UsageDay[] }>
}>()

const loading = shallowRef(false)
const error = shallowRef('')
const days = shallowRef<UsageDay[]>([])

const totals = computed(() => {
  return days.value.reduce(
    (acc, day) => {
      acc.calls += day.callCount
      acc.input += day.inputChars
      acc.output += day.outputChars
      return acc
    },
    { calls: 0, input: 0, output: 0 },
  )
})

const chart = computed(() => {
  const rows = days.value
  const maxIO = Math.max(1, ...rows.map((day) => Math.max(day.inputChars, day.outputChars)))
  const maxCalls = Math.max(1, ...rows.map((day) => day.callCount))
  const width = 640
  const height = 220
  const pad = 28
  const innerW = width - pad * 2
  const innerH = height - pad * 2
  const n = Math.max(rows.length - 1, 1)

  function xAt(index: number) {
    return pad + (innerW * index) / n
  }
  function yIO(value: number) {
    return pad + innerH - (innerH * value) / maxIO
  }
  function yCalls(value: number) {
    return pad + innerH - (innerH * value) / maxCalls
  }

  const inputPoints = rows.map((day, index) => `${xAt(index)},${yIO(day.inputChars)}`).join(' ')
  const outputPoints = rows.map((day, index) => `${xAt(index)},${yIO(day.outputChars)}`).join(' ')
  const callBars = rows.map((day, index) => {
    const x = xAt(index)
    const y = yCalls(day.callCount)
    const barH = pad + innerH - y
    return { x: x - 8, y, width: 16, height: Math.max(barH, 0), value: day.callCount, label: day.date.slice(5) }
  })

  return { width, height, pad, inputPoints, outputPoints, callBars, maxIO, maxCalls }
})

async function reload() {
  if (!props.connected) {
    error.value = '请先连接 Runtime'
    days.value = []
    return
  }
  loading.value = true
  error.value = ''
  try {
    const result = await props.listUsage(7)
    days.value = result.days
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载失败'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void reload()
})
</script>

<template>
  <section>
    <div class="eyebrow">USAGE</div>
    <h1>AI 用量</h1>
    <p class="lead">近 7 日本地 AI 调用统计（按字符串长度估算输入/输出，非厂商 token）。</p>

    <div class="btn-row" style="margin-top: 12px">
      <button class="secondary-action" type="button" :disabled="loading" @click="reload">
        {{ loading ? '刷新中…' : '刷新' }}
      </button>
    </div>

    <p v-if="error" class="error">{{ error }}</p>

    <div class="metrics">
      <article>
        <span>调用次数</span>
        <strong>{{ totals.calls }}</strong>
        <small>近 7 日合计</small>
      </article>
      <article>
        <span>输入字符</span>
        <strong>{{ totals.input.toLocaleString() }}</strong>
        <small>prompt / system</small>
      </article>
      <article>
        <span>输出字符</span>
        <strong>{{ totals.output.toLocaleString() }}</strong>
        <small>模型回复</small>
      </article>
    </div>

    <article v-if="days.length" class="form-card chart-card">
      <h3>趋势</h3>
      <svg
        class="usage-chart"
        :viewBox="`0 0 ${chart.width} ${chart.height}`"
        role="img"
        aria-label="AI usage chart"
      >
        <polyline
          class="line-input"
          fill="none"
          stroke-width="2.5"
          :points="chart.inputPoints"
        />
        <polyline
          class="line-output"
          fill="none"
          stroke-width="2.5"
          :points="chart.outputPoints"
        />
        <rect
          v-for="(bar, index) in chart.callBars"
          :key="index"
          class="bar-calls"
          :x="bar.x"
          :y="bar.y"
          :width="bar.width"
          :height="bar.height"
          rx="3"
        />
        <text
          v-for="(bar, index) in chart.callBars"
          :key="`l-${index}`"
          class="axis-label"
          :x="bar.x + 8"
          :y="chart.height - 8"
          text-anchor="middle"
        >
          {{ bar.label }}
        </text>
      </svg>
      <div class="chart-legend">
        <span class="leg-input">输入字符</span>
        <span class="leg-output">输出字符</span>
        <span class="leg-calls">调用次数</span>
      </div>
    </article>

    <div v-if="days.length" class="list usage-table">
      <article v-for="day in [...days].reverse()" :key="day.date">
        <strong>{{ day.date }}</strong>
        <small>
          调用 {{ day.callCount }} · 入 {{ day.inputChars.toLocaleString() }} · 出 {{ day.outputChars.toLocaleString() }}
        </small>
      </article>
    </div>
  </section>
</template>
