<script setup lang="ts">
defineProps<{ title: string; hint: string }>()
const emit = defineEmits<{ back: [] }>()
</script>

<template>
  <section class="settings">
    <div class="settings-bar">
      <button class="icon-btn" type="button" aria-label="返回" @click="emit('back')">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path fill="currentColor" d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
        </svg>
      </button>
      <strong>{{ title }}</strong>
    </div>
    <div class="card">
      <p class="hint">{{ hint }}</p>
      <slot />
    </div>
  </section>
</template>
