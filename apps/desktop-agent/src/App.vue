<script setup lang="ts">
import { shallowRef } from 'vue'
import AppSidebar from './components/AppSidebar.vue'
import DashboardView from './components/DashboardView.vue'
import DataListView from './components/DataListView.vue'
import ChatView from './components/ChatView.vue'
import SettingsView from './components/SettingsView.vue'
import { useRuntimeClient } from './composables/useRuntimeClient'
const active = shallowRef('Dashboard')
const runtime = useRuntimeClient()
window.__workcopilotRequest = runtime.request
const endpoints: Record<string, string> = { Workflows: '/api/workflows', Memory: '/api/memories', Projects: '/api/projects' }
</script>
<template>
  <div class="app-shell">
    <AppSidebar :active="active" :connected="runtime.connected.value" @navigate="active = $event" />
    <main class="content">
      <DashboardView v-if="active === 'Dashboard'" :connected="runtime.connected.value" />
      <DataListView v-else-if="endpoints[active]" :title="active" :endpoint="endpoints[active]!" />
      <ChatView v-else-if="active === 'Chat'" />
      <SettingsView v-else-if="active === 'Settings'" @connect="runtime.connect" />
    </main>
  </div>
</template>
