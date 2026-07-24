<script setup lang="ts">
defineProps<{
  connected: boolean
  recording: boolean
}>()
</script>

<template>
  <div class="status-row">
    <span class="tag" :data-on="connected">
      <i class="dot" />
      {{ connected ? '已连接' : '未连接' }}
    </span>
    <span v-if="recording" class="tag tag-rec" data-on="true">
      <i class="dot" />
      录制中
    </span>
  </div>
</template>
