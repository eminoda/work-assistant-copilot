<script setup lang="ts">
import { reactive, watch } from 'vue'

const props = defineProps<{ keys: string[] }>()
const emit = defineEmits<{
  save: [values: Record<string, string>]
  skip: []
}>()

const values = reactive<Record<string, string>>({})
watch(
  () => props.keys,
  (keys) => {
    for (const key of Object.keys(values)) delete values[key]
    for (const key of keys) values[key] = ''
  },
  { immediate: true },
)

function submit() {
  const missing = props.keys.find((key) => !values[key]?.trim())
  if (missing) return
  emit('save', Object.fromEntries(props.keys.map((key) => [key, values[key]!.trim()])))
}
</script>

<template>
  <section class="card">
    <strong>Save credentials</strong>
    <p class="muted">Passwords are not stored in the recording. Enter them once for local replay.</p>
    <label v-for="key in keys" :key="key" class="credential">
      <span>{{ key }}</span>
      <input v-model="values[key]" type="password" autocomplete="new-password" :placeholder="key" />
    </label>
    <div class="row">
      <button class="secondary" type="button" @click="emit('skip')">Skip for now</button>
      <button type="button" @click="submit">Save &amp; continue</button>
    </div>
  </section>
</template>
