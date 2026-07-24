<script setup lang="ts">
import SubPageHeader from './SubPageHeader.vue'

defineProps<{ title: string; description?: string }>()
const emit = defineEmits<{ back: []; close: [] }>()
</script>

<template>
  <section class="sub-page">
    <SubPageHeader :title="title" @back="emit('back')" @close="emit('close')" />
    <div class="coming-soon card">
      <div class="coming-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="28" height="28">
          <path fill="currentColor" d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8L12 2z" />
        </svg>
      </div>
      <strong>敬请期待</strong>
      <p class="hint">{{ description || '该功能正在规划中，后续版本开放。' }}</p>
    </div>
  </section>
</template>
