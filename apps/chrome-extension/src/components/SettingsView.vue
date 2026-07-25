<script setup lang="ts">
import { onMounted, shallowRef } from 'vue'

const props = defineProps<{
  status: string
  initialToken: string
  connect: (token: string) => Promise<void>
  getSettings: () => Promise<Record<string, string>>
  setScanRoots: (roots: string[]) => Promise<unknown>
  listModels: () => Promise<Array<{
    id: string
    name: string
    providerType: string
    baseUrl: string | null
    model: string
    enabled: boolean
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

const emit = defineEmits<{ back: [] }>()

const token = shallowRef(props.initialToken)
const busy = shallowRef(false)
const error = shallowRef('')

const rootsText = shallowRef('')
const rootsBusy = shallowRef(false)
const rootsMsg = shallowRef('')

const modelBaseUrl = shallowRef('https://api.openai.com/v1')
const modelName = shallowRef('gpt-4o-mini')
const modelKey = shallowRef('')
const modelBusy = shallowRef(false)
const modelMsg = shallowRef('')
const models = shallowRef<Array<{ id: string; name: string; model: string; enabled: boolean; baseUrl: string | null }>>([])

const scanBusy = shallowRef(false)
const scanMsg = shallowRef('')

async function onConnect() {
  busy.value = true
  error.value = ''
  try {
    await props.connect(token.value)
    emit('back')
  } catch (err) {
    error.value = err instanceof Error ? err.message : '连接失败'
  } finally {
    busy.value = false
  }
}

async function loadExtras() {
  try {
    const settings = await props.getSettings()
    const raw = settings['scan.roots'] ?? '[]'
    try {
      const parsed = JSON.parse(raw) as unknown
      rootsText.value = Array.isArray(parsed) ? parsed.join('\n') : raw
    } catch {
      rootsText.value = raw
    }
    models.value = await props.listModels()
    const enabled = models.value.find((item) => item.enabled)
    if (enabled) {
      modelName.value = enabled.model
      if (enabled.baseUrl) modelBaseUrl.value = enabled.baseUrl
    }
  } catch {
    // token may be missing
  }
}

async function saveRoots() {
  rootsBusy.value = true
  rootsMsg.value = ''
  try {
    const roots = rootsText.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    await props.setScanRoots(roots)
    rootsMsg.value = `已保存 ${roots.length} 个扫描目录`
  } catch (err) {
    rootsMsg.value = err instanceof Error ? err.message : '保存失败'
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
      model: modelName.value.trim(),
      apiKey: modelKey.value.trim(),
      enabled: true,
      ...(modelBaseUrl.value.trim() ? { baseURL: modelBaseUrl.value.trim() } : {}),
    })
    modelKey.value = ''
    modelMsg.value = '模型已保存并启用'
    models.value = await props.listModels()
  } catch (err) {
    modelMsg.value = err instanceof Error ? err.message : '保存失败'
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
      date?: string
      dates?: string[]
      roots?: string[]
      errors?: string[]
    }
    const range = result.dates?.length
      ? `${result.dates[result.dates.length - 1]} ~ ${result.dates[0]}`
      : result.date
    const errHint = result.errors?.length ? `；错误 ${result.errors.length}` : ''
    scanMsg.value = `扫描完成（${range}）：发现仓库 ${result.projects ?? 0}，有提交 ${result.withCommits ?? 0}，写入 ${result.itemsAdded ?? 0}${errHint}。定时任务仍只扫「昨天」。`
  } catch (err) {
    scanMsg.value = err instanceof Error ? err.message : '扫描失败'
  } finally {
    scanBusy.value = false
  }
}

onMounted(() => {
  void loadExtras()
})
</script>

<template>
  <section class="settings">
    <div class="settings-bar">
      <button class="icon-btn" type="button" aria-label="Back" @click="emit('back')">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path fill="currentColor" d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
        </svg>
      </button>
      <strong>Settings</strong>
    </div>

    <div class="card">
      <div class="row">
        <strong>Runtime token</strong>
        <span class="status">{{ status }}</span>
      </div>
      <label class="field">
        Bearer token
        <input
          v-model="token"
          type="password"
          autocomplete="off"
          placeholder="Paste runtime.token.secret"
          @keydown.enter.prevent="onConnect"
        />
      </label>
      <button class="secondary" type="button" :disabled="busy || !token.trim()" @click="onConnect">
        {{ busy ? 'Connecting…' : 'Save & connect' }}
      </button>
      <p v-if="error" class="error">{{ error }}</p>
      <p class="hint">Token is stored in this extension’s local storage only.</p>
      <p class="hint">扫描目录、AI 模型等业务配置以本页为准；Desktop 客户端仅连接 Runtime。</p>
    </div>

    <div class="card">
      <strong>Git 扫描目录</strong>
      <p class="hint">每行一个根目录；启动 Desktop 后会递归发现 git 仓库并扫描昨日提交。</p>
      <label class="field">
        目录列表
        <textarea v-model="rootsText" rows="4" placeholder="D:\coding&#10;D:\work" />
      </label>
      <div class="row">
        <button class="secondary" type="button" :disabled="rootsBusy" @click="saveRoots">
          {{ rootsBusy ? '保存中…' : '保存目录' }}
        </button>
        <button class="secondary" type="button" :disabled="scanBusy" @click="runScan">
          {{ scanBusy ? '扫描中…' : '立即扫描近 7 天' }}
        </button>
      </div>
      <p v-if="rootsMsg" class="hint">{{ rootsMsg }}</p>
      <p v-if="scanMsg" class="hint">{{ scanMsg }}</p>
    </div>

    <div class="card">
      <strong>AI 模型（OpenAI 兼容）</strong>
      <p class="hint">用于将昨日 Git 变更总结为日报条目。使用 Vercel AI SDK / openai-compatible。</p>
      <label class="field">
        API 地址
        <input v-model="modelBaseUrl" placeholder="https://api.openai.com/v1" />
      </label>
      <label class="field">
        模型名称
        <input v-model="modelName" placeholder="gpt-4o-mini" />
      </label>
      <label class="field">
        API Key (SK)
        <input v-model="modelKey" type="password" autocomplete="off" placeholder="sk-…" />
      </label>
      <button class="secondary" type="button" :disabled="modelBusy" @click="saveModelConfig">
        {{ modelBusy ? '保存中…' : '保存并启用模型' }}
      </button>
      <p v-if="modelMsg" class="hint">{{ modelMsg }}</p>
      <ul v-if="models.length" class="hint model-list">
        <li v-for="item in models" :key="item.id">
          {{ item.model }}{{ item.enabled ? ' · 启用中' : '' }}
          <template v-if="item.baseUrl"> · {{ item.baseUrl }}</template>
        </li>
      </ul>
    </div>
  </section>
</template>
