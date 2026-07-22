<script setup lang="ts">
import { shallowRef } from 'vue'
defineProps<{ status: string }>()
const emit = defineEmits<{ connect: [token: string] }>()
const token = shallowRef('')
</script>
<template>
  <section class="card">
    <div class="row"><strong>Runtime</strong><span class="status">{{ status }}</span></div>
    <input v-model="token" type="password" placeholder="Local runtime token" autocomplete="off" />
    <button class="secondary" @click="emit('connect', token)">Connect</button>
  </section>
</template>
