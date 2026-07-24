<script setup lang="ts">
defineProps<{ status: string }>()
</script>

<template>
  <section class="card">
    <div class="row">
      <strong>Runtime</strong>
      <span class="status">{{ status }}</span>
    </div>
    <p class="hint">Configure the runtime token in Settings.</p>
  </section>
</template>
