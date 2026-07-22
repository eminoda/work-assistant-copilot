<script setup lang="ts">
import { shallowRef } from 'vue'
const emit = defineEmits<{ connect: [token: string] }>()
const token = shallowRef('')
</script>
<template>
  <section><div class="eyebrow">LOCAL CONFIGURATION</div><h1>Settings</h1>
    <article class="form-card"><label>Runtime token<input v-model="token" type="password" autocomplete="off" /></label><button @click="emit('connect', token)">Connect runtime</button></article>
    <article class="form-card"><h3>Security boundary</h3><p>Runtime listens only on 127.0.0.1. Secrets are stored separately from SQLite records.</p></article>
  </section>
</template>
