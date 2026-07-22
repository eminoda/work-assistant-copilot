<script setup lang="ts">
defineProps<{ active: string; connected: boolean }>()
const emit = defineEmits<{ navigate: [view: string] }>()
const items = ['Dashboard', 'Workflows', 'Memory', 'Projects', 'Chat', 'Settings']
</script>
<template>
  <aside class="sidebar">
    <div class="brand"><span>W</span><div><b>WorkCopilot</b><small>AI Worker Runtime</small></div></div>
    <nav><button v-for="item in items" :key="item" :class="{ active: item === active }" @click="emit('navigate', item)">{{ item }}</button></nav>
    <div class="runtime"><i :class="{ online: connected }"></i>{{ connected ? 'Runtime online' : 'Runtime offline' }}</div>
  </aside>
</template>
