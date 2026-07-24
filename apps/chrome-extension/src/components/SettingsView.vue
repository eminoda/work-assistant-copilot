<script setup lang="ts">
import { shallowRef } from 'vue'

const props = defineProps<{
  status: string
  initialToken: string
  connect: (token: string) => Promise<void>
}>()

const emit = defineEmits<{ back: [] }>()

const token = shallowRef(props.initialToken)
const busy = shallowRef(false)
const error = shallowRef('')

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
    </div>
  </section>
</template>
