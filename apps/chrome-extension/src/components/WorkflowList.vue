<script setup lang="ts">
defineProps<{ workflows: Array<{ id: string; name: string; intent: string }> }>()
const emit = defineEmits<{ execute: [id: string] }>()
</script>
<template>
  <section class="card">
    <strong>Workflows</strong>
    <p v-if="workflows.length === 0" class="muted">No workflows recorded yet.</p>
    <article v-for="workflow in workflows" :key="workflow.id" class="workflow">
      <div><b>{{ workflow.name }}</b><small>{{ workflow.intent }}</small></div>
      <button class="secondary" @click="emit('execute', workflow.id)">Run</button>
    </article>
  </section>
</template>
