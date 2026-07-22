<script setup lang="ts">
import { shallowRef } from 'vue'
const message = shallowRef('')
const replies = shallowRef<Array<{ role: string; text: string }>>([])
const send = async () => {
  if (!message.value.trim() || !window.__workcopilotRequest) return
  const text = message.value; replies.value = [...replies.value, { role: 'user', text }]; message.value = ''
  const response = await window.__workcopilotRequest<{ message: string }>('/api/chat', { method: 'POST', body: JSON.stringify({ message: text }) })
  replies.value = [...replies.value, { role: 'assistant', text: response.message }]
}
</script>
<template>
  <section><div class="eyebrow">AI WORK ASSISTANT</div><h1>Chat</h1>
    <div class="chat"><p v-if="replies.length === 0" class="empty">Ask me to summarize today, inspect memory, or explain available workflows.</p><article v-for="(reply, index) in replies" :key="index" :class="reply.role">{{ reply.text }}</article></div>
    <form class="composer" @submit.prevent="send"><input v-model="message" placeholder="What would you like to do?" /><button>Send</button></form>
  </section>
</template>
