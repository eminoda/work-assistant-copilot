<script setup lang="ts">
import { onMounted, shallowRef } from 'vue'
import type { ProjectDetail, ProjectRow } from '../composables/useRuntimeClient'

const props = defineProps<{
  connected: boolean
  listProjects: () => Promise<ProjectRow[]>
  getProject: (id: string) => Promise<ProjectDetail>
}>()

const loading = shallowRef(false)
const error = shallowRef('')
const projects = shallowRef<ProjectRow[]>([])
const selectedId = shallowRef<string | null>(null)
const detail = shallowRef<ProjectDetail | null>(null)
const detailLoading = shallowRef(false)

async function reload() {
  if (!props.connected) {
    error.value = '请先连接 Runtime'
    projects.value = []
    return
  }
  loading.value = true
  error.value = ''
  try {
    projects.value = await props.listProjects()
    if (selectedId.value && !projects.value.some((item) => item.id === selectedId.value)) {
      selectedId.value = null
      detail.value = null
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载失败'
  } finally {
    loading.value = false
  }
}

async function openProject(id: string) {
  selectedId.value = id
  detailLoading.value = true
  try {
    detail.value = await props.getProject(id)
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载详情失败'
    detail.value = null
  } finally {
    detailLoading.value = false
  }
}

onMounted(() => {
  void reload()
})
</script>

<template>
  <section>
    <div class="eyebrow">PROJECTS</div>
    <h1>项目</h1>
    <p class="lead">查看已扫描的 Git 项目，以及关联的日报与 AI 分析状态。</p>

    <div class="btn-row" style="margin-top: 12px">
      <button class="secondary-action" type="button" :disabled="loading" @click="reload">
        {{ loading ? '刷新中…' : '刷新' }}
      </button>
    </div>
    <p v-if="error" class="error">{{ error }}</p>

    <div class="split-pane">
      <div class="split-list">
        <p v-if="!projects.length && !loading" class="empty">暂无项目，请先配置扫描目录并执行扫描。</p>
        <button
          v-for="item in projects"
          :key="item.id"
          type="button"
          class="split-item"
          :data-active="selectedId === item.id"
          @click="openProject(item.id)"
        >
          <strong>{{ item.name }}</strong>
          <small>{{ item.path }}</small>
        </button>
      </div>

      <div class="split-detail">
        <p v-if="!selectedId" class="empty">选择左侧项目查看详情</p>
        <p v-else-if="detailLoading" class="hint">加载中…</p>
        <template v-else-if="detail">
          <h2>{{ detail.project.name }}</h2>
          <dl class="meta-grid">
            <div><dt>路径</dt><dd>{{ detail.project.path }}</dd></div>
            <div><dt>Git URL</dt><dd>{{ detail.project.gitUrl || '—' }}</dd></div>
            <div><dt>创建时间</dt><dd>{{ new Date(detail.project.createdAt).toLocaleString() }}</dd></div>
          </dl>

          <h3>关联日报</h3>
          <p v-if="!detail.journals.length" class="hint">近 60 天暂无匹配该项目的日报。</p>
          <div v-else class="list compact-list">
            <article v-for="journal in detail.journals" :key="journal.id">
              <strong>{{ journal.date }}</strong>
              <small>
                {{ journal.itemCount }} 项 · Git {{ journal.gitItemCount }}
                · AI {{ journal.hasAi ? (journal.aiUpToDate ? '已分析' : '待更新') : '未分析' }}
              </small>
            </article>
          </div>

          <h3>近期快照</h3>
          <p v-if="!detail.snapshots.length" class="hint">暂无 GitSnapshot。</p>
          <div v-else class="list compact-list">
            <article v-for="snap in detail.snapshots" :key="snap.id">
              <strong>{{ snap.commitHash.slice(0, 8) }}</strong>
              <small>{{ snap.summary || '—' }} · {{ new Date(snap.createdAt).toLocaleString() }}</small>
            </article>
          </div>
        </template>
      </div>
    </div>
  </section>
</template>
