<script setup lang="ts">
defineProps<{
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
}>()
const emit = defineEmits<{ confirm: []; cancel: [] }>()
</script>

<template>
  <div class="confirm-mask" role="dialog" aria-modal="true">
    <section class="card confirm-dialog">
      <strong>{{ title }}</strong>
      <p class="hint">{{ message }}</p>
      <div class="row">
        <button class="secondary" type="button" @click="emit('cancel')">
          {{ cancelLabel || '取消' }}
        </button>
        <button class="danger" type="button" @click="emit('confirm')">
          {{ confirmLabel || '删除' }}
        </button>
      </div>
    </section>
  </div>
</template>
