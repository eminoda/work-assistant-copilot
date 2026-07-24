# 架构设计

## 总体结构

```text
┌─────────────────────┐     ┌──────────────────────┐
│  Browser Agent      │     │  Desktop Agent       │
│  (Chrome Extension) │◄───►│  (Tauri + Vue)       │
│  录制 / 触发 / UI   │     │  宿主 / 托盘 / 定时  │
└─────────┬───────────┘     └──────────┬───────────┘
          │  HTTP + token              │ 启停 Runtime
          │  (SSE / WS 可选)           │
          └────────────┬───────────────┘
                       ▼
          ┌────────────────────────┐
          │  AI Runtime            │
          │  (Hono agent-core)     │
          │  127.0.0.1 + Bearer    │
          └────────────┬───────────┘
                       │
     ┌─────────────────┼─────────────────┐
     ▼                 ▼                 ▼
 Workflow Engine   Tool Registry    本地存储
     │                 │            SQLite + credentials
     │                 ├─ Playwright
     │                 ├─ Git / Memory
     │                 ├─ Credential
     │                 └─ Export / Notify（规划）
     └─ Workflow DSL（可持久、可组合、可调试）
```

## 三端职责

### Browser Agent（Chrome 扩展）

**负责：**

- 作为用户日常入口：Side Panel、连接 Runtime、录制开关
- 页面内采集：input、button click、tab 激活/切换、导航等
- 产出 selector / 事件序列，提交给 Runtime 落成 DSL
- 密码类字段不落明文：引导用户填写 credential，占位替换
- 录制中可选「文本元素」纳入后续消息通知（规划）
- 人工介入点：二维码 / 短信等场景配置「等待 URL 变化」后再续跑（规划）

**不负责：**

- 长期后台定时（扩展生命周期受限）
- Playwright 驱动浏览器执行回放
- 系统级通知、任意 CLI、大规模本地文件扫描

### Desktop Agent（Tauri）

**负责：**

- 宿主：启动/停止本地 AI Runtime
- 设置：Runtime token、工作目录、模型等配置入口
- 后台常驻：托盘、定时任务（Git 扫描、提醒策略）
- 承接扩展交办事项的执行调度与状态展示
- 系统通知出口（规划）

**与扩展关系：** 双方通过本地 Runtime API（Bearer token）协同，而不是扩展直接调 Playwright。

### AI Runtime（agent-core）

**负责：**

- 统一 HTTP API：workflows、recordings、credentials、projects、memories、chat…
- Workflow 存储与执行编排（Workflow Engine → Tool Registry）
- 凭证与会话类密钥的本地读写
- 模型 Provider 抽象（后续用于 diff 总结、对话编排）
- 事件推送（SSE / WebSocket）供 UI 观察执行进度

**边界：**

- 模型只产出意图 / DSL / 总结文本，**不**直接执行任意脚本
- Playwright **仅**存在于 `playwright-runtime` 包，经注册工具调用

## 数据落点

| 类型 | 位置（默认） |
|------|----------------|
| SQLite（workflow / memory / project…） | `~/.workcopilot/` |
| 凭证、session cookie、runtime token | `~/.workcopilot/credentials/` |
| 扩展内临时连接 token | 扩展 `localStorage`（仅本机） |

可通过环境变量 `WORKCOPILOT_HOME` 覆盖根目录。

## 仓库地图（实现侧）

| 路径 | 角色 |
|------|------|
| `apps/chrome-extension` | Browser Agent |
| `apps/desktop-agent` | Desktop Agent（含 Prisma schema） |
| `packages/agent-core` | AI Runtime API |
| `packages/browser-recorder` | 事件 → Workflow DSL |
| `packages/workflow-engine` | 步骤编排 |
| `packages/tool-registry` | 工具契约与分发 |
| `packages/playwright-runtime` | 浏览器执行 |
| `packages/credential-provider` | 本地密钥 |
| `packages/git-analyzer` / `memory-engine` | 开发工作记忆原料 |
| `packages/model-provider` | 模型接入 |
| `packages/feishu-adapter` | 导出（Markdown / 飞书） |

## 安全底线

- Runtime 只绑 `127.0.0.1`，禁止默认暴露到 `0.0.0.0`
- 除 `/api/health` 外需 `Authorization: Bearer <local-token>`
- 密码不进录制明文；cookie/session 以 credential 形式引用
