<script setup lang="ts">
defineProps<{ connected: boolean }>()
</script>
<template>
  <section>
    <div class="eyebrow">SYSTEM OVERVIEW</div><h1>Good evening.</h1><p class="lead">Your local work assistant keeps browser workflows and development memory under your control.</p>
    <div class="metrics">
      <article><span>Runtime</span><strong>{{ connected ? 'Healthy' : 'Offline' }}</strong><small>127.0.0.1:4317</small></article>
      <article><span>Privacy</span><strong>Local first</strong><small>No cloud backend</small></article>
      <article><span>Automation</span><strong>Workflow DSL</strong><small>Auditable execution</small></article>
    </div>
    <article class="hero-card"><div><span class="pill">MVP READY</span><h2>Record once. Run safely.</h2><p>Use the Chrome side panel to capture a task, then replay it through validated tools.</p></div></article>
  </section>
</template>
