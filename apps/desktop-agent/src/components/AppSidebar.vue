<script setup lang="ts">
defineProps<{ active: string; connected: boolean }>()
const emit = defineEmits<{ navigate: [view: string] }>()

const items = [
  { id: 'Settings', label: '设置' },
  { id: 'Analytics', label: 'AI 用量' },
  { id: 'Projects', label: '项目' },
  { id: 'Recordings', label: '录制' },
] as const

async function quitApp() {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('quit_app')
  } catch {
    window.close()
  }
}
</script>

<template>
  <aside class="sidebar">
    <div class="brand">
      <span>W</span>
      <div>
        <b>WorkCopilot</b>
        <small>Desktop Agent</small>
      </div>
    </div>
    <nav>
      <button
        v-for="item in items"
        :key="item.id"
        :class="{ active: item.id === active }"
        type="button"
        @click="emit('navigate', item.id)"
      >
        {{ item.label }}
      </button>
    </nav>
    <div class="sidebar-footer">
      <div class="runtime">
        <i :class="{ online: connected }"></i>
        {{ connected ? 'Runtime online' : 'Runtime offline' }}
      </div>
      <p class="tray-hint">关闭窗口会退到托盘；右下角托盘图标可重新打开，选「退出」才会真正结束。</p>
      <button class="quit-action" type="button" @click="quitApp">退出应用</button>
    </div>
  </aside>
</template>
