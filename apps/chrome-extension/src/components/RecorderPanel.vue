<script setup lang="ts">
defineProps<{ active: boolean; count: number }>()
const emit = defineEmits<{ start: []; stop: [] }>()
</script>
<template>
  <section class="card">
    <div class="row"><strong>Recorder</strong><span>{{ count }} events</span></div>
    <p>Capture navigation, clicks and inputs as a validated Workflow DSL.</p>
    <button v-if="!active" @click="emit('start')">Start recording</button>
    <button v-else class="danger" @click="emit('stop')">Stop and save</button>
  </section>
</template>
