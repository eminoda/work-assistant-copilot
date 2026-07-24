<script setup lang="ts">
defineProps<{ title: string }>()
const emit = defineEmits<{ back: []; close: [] }>()
</script>

<template>
  <header class="sub-header">
    <button class="icon-btn" type="button" aria-label="返回" @click="emit('back')">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path fill="currentColor" d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
      </svg>
    </button>
    <h2 class="sub-title">{{ title }}</h2>
    <button class="icon-btn" type="button" aria-label="关闭" @click="emit('close')">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path fill="currentColor" d="M18.3 5.71 12 12l6.3 6.29-1.41 1.42L10.59 13.4 4.3 19.71 2.89 18.3 9.17 12 2.89 5.71 4.3 4.29 10.59 10.6l6.3-6.3z" />
      </svg>
    </button>
  </header>
</template>
