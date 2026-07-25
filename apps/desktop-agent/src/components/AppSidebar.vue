<script setup lang="ts">
defineProps<{ active: string; connected: boolean }>()
const emit = defineEmits<{ navigate: [view: string] }>()

const items = [
  { id: 'Settings', label: '设置' },
  { id: 'Analytics', label: 'AI 用量' },
  { id: 'Projects', label: '项目' },
  { id: 'Recordings', label: '录制' },
] as const
</script>

<template>
  <aside class="sidebar">
    <div class="brand">
      <span>W</span>
      <div>
        <b>WorkCopilot</b>
        <small>Desktop Agent</small>
      </div>
    </div>
    <nav>
      <button
        v-for="item in items"
        :key="item.id"
        :class="{ active: item.id === active }"
        type="button"
        @click="emit('navigate', item.id)"
      >
        {{ item.label }}
      </button>
    </nav>
    <div class="runtime">
      <i :class="{ online: connected }"></i>
      {{ connected ? 'Runtime online' : 'Runtime offline' }}
    </div>
  </aside>
</template>
