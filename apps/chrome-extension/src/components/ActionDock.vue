<script setup lang="ts">
defineProps<{ recording: boolean; unreadCount?: number }>()
const emit = defineEmits<{
  record: []
  notify: []
  report: []
  chat: []
}>()
</script>

<template>
  <nav class="action-dock" aria-label="快捷功能">
    <button
      class="action-tile"
      type="button"
      :data-active="recording"
      @click="emit('record')"
    >
      <span class="action-icon action-record" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="22" height="22">
          <circle cx="12" cy="12" r="7" fill="currentColor" />
        </svg>
      </span>
      <span class="action-label">录制</span>
    </button>

    <button class="action-tile" type="button" @click="emit('notify')">
      <span class="action-icon action-notify" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="22" height="22">
          <path
            fill="currentColor"
            d="M12 22a2.2 2.2 0 0 0 2.2-2.2h-4.4A2.2 2.2 0 0 0 12 22zm7-5.5V11a7 7 0 1 0-14 0v5.5L3 18.5V20h18v-1.5l-2-2z"
          />
        </svg>
        <i v-if="(unreadCount || 0) > 0" class="badge-count">{{ unreadCount! > 99 ? '99+' : unreadCount }}</i>
      </span>
      <span class="action-label">通知</span>
    </button>

    <button class="action-tile" type="button" @click="emit('report')">
      <span class="action-icon action-report" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="22" height="22">
          <path
            fill="currentColor"
            d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm3 4v2h10V8H7zm0 4v2h7v-2H7zm0 4v2h5v-2H7z"
          />
        </svg>
      </span>
      <span class="action-label">周报</span>
    </button>

    <button class="action-tile" type="button" @click="emit('chat')">
      <span class="action-icon action-chat" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="22" height="22">
          <path
            fill="currentColor"
            d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm4 5v2h8V9H8zm0 4v2h5v-2H8z"
          />
        </svg>
      </span>
      <span class="action-label">聊天</span>
    </button>
  </nav>
</template>
