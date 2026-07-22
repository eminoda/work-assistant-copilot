<script setup lang="ts">
import { onMounted, shallowRef } from 'vue'
const props = defineProps<{ title: string; endpoint: string }>()
const emit = defineEmits<{ select: [item: Record<string, unknown>] }>()
const items = shallowRef<Array<Record<string, unknown>>>([])
const error = shallowRef('')
const request = injectRequest()
function injectRequest() {
  const value = window.__workcopilotRequest
  if (!value) throw new Error('Runtime request client unavailable')
  return value
}
onMounted(async () => {
  try { items.value = await request(props.endpoint) } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
})
</script>
<template>
  <section><div class="eyebrow">LOCAL DATA</div><h1>{{ title }}</h1>
    <p v-if="error" class="error">{{ error }}</p><p v-else-if="items.length === 0" class="empty">No entries yet.</p>
    <div class="list"><button v-for="item in items" :key="String(item.id)" @click="emit('select', item)"><b>{{ item.name ?? item.date ?? item.type }}</b><small>{{ item.intent ?? item.content ?? item.path }}</small></button></div>
  </section>
</template>
