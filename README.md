# WorkCopilot

基于 **Browser Agent + Desktop Agent + AI Runtime** 的个人工作助手。

融入日常办公：减少门户反复登录、沉淀开发工作事实、把提醒与定时交给本机后台——**释放双手，把时间留给思考与沉淀**。

设计说明（愿景 / 架构 / 功能 / 路线图）见 **[docs/](./docs/README.md)**。  
旧版 [`WORK_COPILOT_SYSTEM_DESIGN.md`](./WORK_COPILOT_SYSTEM_DESIGN.md) 仅作历史参考。

## 怎么分工

| 组件 | 角色 |
|------|------|
| **Browser Agent**（Chrome 扩展） | 办公主入口：录制页面操作、触发执行、轻量设置 |
| **Desktop Agent**（Tauri） | 宿主 Runtime、后台定时、存储与系统能力（扩展权限不够时由它承接） |
| **AI Runtime**（`agent-core`） | 本地 `127.0.0.1` API：Workflow DSL、工具执行、凭证与记忆 |

```text
Chrome Extension  ──HTTP+token──►  AI Runtime  ◄──启停──  Tauri Desktop
     录制/触发                      Workflow / Tools              定时/通知
```

模型不直接生成可执行业务脚本；能力一律经 **Workflow DSL → Tool Registry** 落地。

## 环境

- Node.js 22+
- pnpm 10+
- Rust 1.77+（Tauri）
- Chrome / Chromium

```powershell
pnpm install
pnpm db:generate
pnpm db:push
pnpm exec playwright install chromium
```

数据默认在 `~/.workcopilot`（可用 `WORKCOPILOT_HOME` 覆盖）。环境变量见 `.env.example`。

## 启动

**仅 Runtime：**

```powershell
pnpm runtime
```

监听 `127.0.0.1:4317`。首次启动会生成 `~/.workcopilot/credentials/runtime.token.secret`，扩展与桌面端 Settings 填入该 token。

**桌面端（推荐，会拉起 Runtime）：**

```powershell
pnpm --filter @workcopilot/desktop-agent tauri
```

仅前端：`pnpm --filter @workcopilot/desktop-agent dev`

**Chrome 扩展：**

```powershell
pnpm --filter @workcopilot/chrome-extension build
```

1. `chrome://extensions` → 开发者模式 → 加载已解压的 `apps/chrome-extension/dist`
2. 打开 Side Panel → 齿轮 Settings → 粘贴 runtime token → 连接

## 当前能力（摘要）

- 录制 click / input / 导航 / tab；密码走本地 credential；录制后命名并保存 Workflow
- Playwright 回放；扩展内 Run / Delete / Delete all
- 桌面端已存 token 时启动自动连接

未完成与下一迭代优先级见 [docs/roadmap.md](./docs/roadmap.md)。示例 DSL：`examples/workflows/`。

## 校验

```powershell
pnpm typecheck
pnpm test
pnpm build
```

## 包边界

| 包 | 职责 |
|----|------|
| `agent-core` | Hono API、编排入口 |
| `workflow-engine` | 步骤生命周期 |
| `tool-registry` | Zod 校验工具分发 |
| `browser-recorder` | 录制事件 → DSL |
| `playwright-runtime` | **唯一**允许依赖 Playwright 的包 |
| `credential-provider` | 本地密钥 |
| `git-analyzer` / `memory-engine` | Git 事实与记忆辅助 |
| `model-provider` | 模型抽象 |
| `feishu-adapter` | Markdown / 飞书导出 |

当前阶段不做：云同步、多用户、万能可视化 Workflow 编辑器。
