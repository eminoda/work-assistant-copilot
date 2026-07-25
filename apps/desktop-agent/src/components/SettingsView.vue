<script setup lang="ts">
import { onMounted, shallowRef, watch } from 'vue'

const DEFAULT_MODEL_BASE_URL = 'https://api.deepseek.com'
const DEFAULT_MODEL_NAME = 'deepseek-v4-flash'

const props = defineProps<{
  connected: boolean
  initialToken: string
  connect: (token: string) => Promise<void>
  getSettings: () => Promise<Record<string, string>>
  setScanRoots: (roots: string[]) => Promise<unknown>
  listModels: () => Promise<Array<{
    id: string
    name: string
    model: string
    enabled: boolean
    baseUrl: string | null
  }>>
  saveModel: (input: {
    name: string
    provider: string
    model: string
    baseURL?: string
    apiKey: string
    enabled?: boolean
  }) => Promise<unknown>
  triggerScan: (force?: boolean, lookbackDays?: number) => Promise<unknown>
}>()

const token = shallowRef(props.initialToken)
const busy = shallowRef(false)
const feedback = shallowRef<{ kind: 'ok' | 'error'; text: string } | null>(
  props.connected ? { kind: 'ok', text: '已连接到本地 runtime' } : null,
)

const rootsText = shallowRef('')
const rootsBusy = shallowRef(false)
const rootsMsg = shallowRef('')

const modelBaseUrl = shallowRef(DEFAULT_MODEL_BASE_URL)
const modelName = shallowRef(DEFAULT_MODEL_NAME)
const modelKey = shallowRef('')
const modelBusy = shallowRef(false)
const modelMsg = shallowRef('')
const modelEnabledHint = shallowRef('')

const scanBusy = shallowRef(false)
const scanMsg = shallowRef('')

async function onConnect() {
  busy.value = true
  feedback.value = null
  try {
    await props.connect(token.value)
    feedback.value = { kind: 'ok', text: '设置成功，已连接到本地 runtime' }
    await loadExtras()
  } catch (error) {
    feedback.value = {
      kind: 'error',
      text: error instanceof Error ? error.message : '连接失败',
    }
  } finally {
    busy.value = false
  }
}

async function loadExtras() {
  if (!props.connected && !token.value.trim()) return
  try {
    const settings = await props.getSettings()
    const raw = settings['scan.roots'] ?? '[]'
    try {
      const parsed = JSON.parse(raw) as unknown
      rootsText.value = Array.isArray(parsed) ? parsed.join('\n') : raw
    } catch {
      rootsText.value = raw
    }
    modelBaseUrl.value = DEFAULT_MODEL_BASE_URL
    modelName.value = DEFAULT_MODEL_NAME
    modelKey.value = ''
    const models = await props.listModels()
    const enabled = models.find((item) => item.enabled) ?? models[0]
    modelEnabledHint.value = enabled
      ? `当前启用：${enabled.model}${enabled.baseUrl ? ` · ${enabled.baseUrl}` : ''}`
      : '尚未启用模型'
  } catch (error) {
    rootsMsg.value = error instanceof Error ? error.message : '加载设置失败'
  }
}

async function saveRoots() {
  rootsBusy.value = true
  rootsMsg.value = ''
  try {
    const roots = rootsText.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    await props.setScanRoots(roots)
    rootsMsg.value = `已保存 ${roots.length} 个扫描目录`
  } catch (error) {
    rootsMsg.value = error instanceof Error ? error.message : '保存失败'
  } finally {
    rootsBusy.value = false
  }
}

async function saveModelConfig() {
  if (!modelKey.value.trim() || !modelName.value.trim()) {
    modelMsg.value = '请填写模型名与 API Key'
    return
  }
  modelBusy.value = true
  modelMsg.value = ''
  try {
    await props.saveModel({
      name: 'default',
      provider: 'openai-compatible',
      model: modelName.value.trim() || DEFAULT_MODEL_NAME,
      apiKey: modelKey.value.trim(),
      enabled: true,
      baseURL: modelBaseUrl.value.trim() || DEFAULT_MODEL_BASE_URL,
    })
    modelKey.value = ''
    modelMsg.value = '模型已保存并启用'
    await loadExtras()
  } catch (error) {
    modelMsg.value = error instanceof Error ? error.message : '保存失败'
  } finally {
    modelBusy.value = false
  }
}

async function runScan() {
  scanBusy.value = true
  scanMsg.value = ''
  try {
    const result = await props.triggerScan(true, 7) as {
      projects?: number
      withCommits?: number
      itemsAdded?: number
      dates?: string[]
      date?: string
      errors?: string[]
    }
    const range = result.dates?.length
      ? `${result.dates[result.dates.length - 1]} ~ ${result.dates[0]}`
      : result.date
    const errHint = result.errors?.length ? `；错误 ${result.errors.length}` : ''
    scanMsg.value = `扫描完成（${range}）：仓库 ${result.projects ?? 0}，有提交 ${result.withCommits ?? 0}，写入 ${result.itemsAdded ?? 0}${errHint}`
  } catch (error) {
    scanMsg.value = error instanceof Error ? error.message : '扫描失败'
  } finally {
    scanBusy.value = false
  }
}

watch(() => props.connected, (value) => {
  if (value) void loadExtras()
})

onMounted(() => {
  if (props.connected) void loadExtras()
})
</script>

<template>
  <section>
    <div class="eyebrow">LOCAL CONFIGURATION</div>
    <h1>设置</h1>
    <p class="lead">连接本地 Runtime，并维护扫描目录与 AI 模型。</p>

    <article class="form-card">
      <h3>Runtime Token</h3>
      <label>
        Bearer token
        <input
          v-model="token"
          type="password"
          autocomplete="off"
          placeholder="Paste runtime.token.secret"
          @keydown.enter.prevent="onConnect"
        />
      </label>
      <button class="primary-action" type="button" :disabled="busy || !token.trim()" @click="onConnect">
        {{ busy ? 'Connecting…' : 'Save & connect' }}
      </button>
      <p v-if="feedback" class="feedback" :data-kind="feedback.kind">{{ feedback.text }}</p>
    </article>

    <article class="form-card">
      <h3>Git 扫描目录</h3>
      <label>
        每行一个根目录
        <textarea v-model="rootsText" rows="4" placeholder="D:\coding&#10;D:\work" />
      </label>
      <div class="btn-row">
        <button class="primary-action" type="button" :disabled="rootsBusy || !connected" @click="saveRoots">
          {{ rootsBusy ? '保存中…' : '保存目录' }}
        </button>
        <button class="secondary-action" type="button" :disabled="scanBusy || !connected" @click="runScan">
          {{ scanBusy ? '扫描中…' : '立即扫描近 7 天' }}
        </button>
      </div>
      <p v-if="rootsMsg" class="hint">{{ rootsMsg }}</p>
      <p v-if="scanMsg" class="hint">{{ scanMsg }}</p>
    </article>

    <article class="form-card">
      <h3>AI 模型</h3>
      <p class="hint">默认 DeepSeek：API <code>https://api.deepseek.com</code>，模型 <code>deepseek-v4-flash</code>。</p>
      <label>
        API 地址
        <input v-model="modelBaseUrl" placeholder="https://api.deepseek.com" />
      </label>
      <label>
        模型名称
        <input v-model="modelName" placeholder="deepseek-v4-flash" />
      </label>
      <label>
        API Key (SK)
        <input v-model="modelKey" type="password" autocomplete="off" placeholder="sk-…" />
      </label>
      <button class="primary-action" type="button" :disabled="modelBusy || !connected" @click="saveModelConfig">
        {{ modelBusy ? '保存中…' : '保存并启用模型' }}
      </button>
      <p v-if="modelMsg" class="hint">{{ modelMsg }}</p>
      <p v-if="modelEnabledHint" class="hint">{{ modelEnabledHint }}</p>
    </article>
  </section>
</template>
