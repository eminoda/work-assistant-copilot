<script setup lang="ts">
import { shallowRef } from 'vue'

const props = defineProps<{
  connect: (token: string) => Promise<void>
  connected: boolean
}>()

const token = shallowRef(localStorage.getItem('workcopilot.token') ?? '')
const busy = shallowRef(false)
const feedback = shallowRef<{ kind: 'ok' | 'error'; text: string } | null>(
  props.connected ? { kind: 'ok', text: '已连接到本地 runtime' } : null,
)

async function onConnect() {
  busy.value = true
  feedback.value = null
  try {
    await props.connect(token.value)
    feedback.value = { kind: 'ok', text: '设置成功，已连接到本地 runtime' }
  } catch (error) {
    feedback.value = {
      kind: 'error',
      text: error instanceof Error ? error.message : '连接失败',
    }
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section>
    <div class="eyebrow">LOCAL CONFIGURATION</div>
    <h1>Settings</h1>

    <article class="form-card">
      <label>
        Runtime token
        <input
          v-model="token"
          type="password"
          autocomplete="off"
          placeholder="Paste runtime.token.secret"
          @keydown.enter.prevent="onConnect"
        />
      </label>
      <button class="primary-action" type="button" :disabled="busy || !token.trim()" @click="onConnect">
        {{ busy ? 'Connecting…' : 'Connect runtime' }}
      </button>
      <p v-if="feedback" class="feedback" :data-kind="feedback.kind">{{ feedback.text }}</p>
    </article>

    <article class="form-card settings-note">
      <h3>配置入口</h3>
      <p>
        扫描目录、AI 模型（API 地址 / 模型名 / SK）、立即扫描等业务设置，请在
        <strong>Chrome 扩展 → 设置</strong> 中完成。本客户端只负责连接本地 Runtime 并执行扫描任务。
      </p>
    </article>

    <article class="form-card">
      <h3>Security boundary</h3>
      <p>Runtime listens only on 127.0.0.1. Secrets are stored separately from SQLite records.</p>
    </article>
  </section>
</template>

<style scoped>
.settings-note p {
  line-height: 1.55;
  color: inherit;
  opacity: 0.9;
}
</style>
