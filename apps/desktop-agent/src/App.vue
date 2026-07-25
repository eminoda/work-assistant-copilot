<script setup lang="ts">
import { onMounted, shallowRef } from 'vue'
import AppSidebar from './components/AppSidebar.vue'
import SettingsView from './components/SettingsView.vue'
import AnalyticsView from './components/AnalyticsView.vue'
import ProjectsView from './components/ProjectsView.vue'
import RecordingsView from './components/RecordingsView.vue'
import { useRuntimeClient } from './composables/useRuntimeClient'

const active = shallowRef('Settings')
const runtime = useRuntimeClient()
window.__workcopilotRequest = runtime.request

onMounted(() => {
  void runtime.autoConnect()
})
</script>

<template>
  <div class="app-shell">
    <AppSidebar :active="active" :connected="runtime.connected.value" @navigate="active = $event" />
    <main class="content">
      <SettingsView
        v-if="active === 'Settings'"
        :connected="runtime.connected.value"
        :initial-token="runtime.token.value"
        :ensure-local-token="runtime.ensureLocalToken"
        :connect="runtime.connect"
        :get-settings="runtime.getSettings"
        :set-scan-roots="runtime.setScanRoots"
        :list-models="runtime.listModels"
        :save-model="runtime.saveModel"
        :trigger-scan="runtime.triggerJournalScan"
      />
      <AnalyticsView
        v-else-if="active === 'Analytics'"
        :connected="runtime.connected.value"
        :list-usage="runtime.listUsage"
      />
      <ProjectsView
        v-else-if="active === 'Projects'"
        :connected="runtime.connected.value"
        :list-projects="runtime.listProjects"
        :get-project="runtime.getProject"
      />
      <RecordingsView
        v-else-if="active === 'Recordings'"
        :connected="runtime.connected.value"
        :list-workflows="runtime.listWorkflows"
        :get-workflow="runtime.getWorkflow"
        :list-recordings="runtime.listRecordings"
        :get-recording="runtime.getRecording"
      />
    </main>
  </div>
</template>
