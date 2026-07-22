# WorkCopilot

WorkCopilot is a local-first AI worker runtime for browser automation and developer work memory. It records browser activity as validated Workflow DSL, executes every action through a Tool Registry, and keeps credentials and work data on the local machine.

## Architecture

```text
Chrome Extension / Tauri Desktop
              |
       HTTP + SSE + WebSocket
              |
       Hono Agent Runtime
              |
   Workflow Engine -> Tool Registry
       |                  |
 Browser Recorder     Playwright / Git / Memory / Export
```

The language model never generates JavaScript for direct execution. It can classify intent and propose Workflow DSL, but only registered and Zod-validated tools can perform actions.

## Requirements

- Node.js 22+
- pnpm 10+
- Rust 1.77+ and the platform prerequisites for Tauri v2
- Chrome or Chromium

## Setup

```powershell
pnpm install
pnpm db:generate
pnpm db:push
pnpm exec playwright install chromium
```

Optional environment values are documented in `.env.example`. Runtime data is stored in `~/.workcopilot` by default. Override it with `WORKCOPILOT_HOME`.

## Start the runtime

```powershell
pnpm runtime
```

The service listens only on `127.0.0.1:4317`. On first startup it creates `~/.workcopilot/credentials/runtime.token.secret`. Use that token in the desktop app and browser Side Panel.

## Load the Chrome extension

```powershell
pnpm --filter @workcopilot/chrome-extension build
```

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select `apps/chrome-extension/dist`.
5. Click the WorkCopilot extension icon to open the Side Panel.
6. Enter the local runtime token and connect.

The recorder captures navigation, clicks, form submissions and non-secret input. Password fields are converted to credential references; plaintext passwords are never added to recordings.

## Start the desktop app

Web UI development:

```powershell
pnpm --filter @workcopilot/desktop-agent dev
```

Tauri host:

```powershell
pnpm --filter @workcopilot/desktop-agent tauri
```

The Tauri host starts and stops the local runtime, hides the window on close, and provides an explicit tray exit action.

## API

All endpoints except `/api/health` require `Authorization: Bearer <local-token>`.

- `GET /api/health`
- `GET|POST /api/workflows`
- `DELETE /api/workflows/:id`
- `POST /api/workflows/:id/execute`
- `GET /api/executions/:id`
- `POST /api/recordings`
- `GET|POST /api/projects`
- `POST /api/projects/:id/scan`
- `GET|POST /api/memories`
- `POST /api/reports`
- `GET|PUT /api/settings/:key`
- `GET|POST /api/models`
- `POST /api/models/test`
- `POST /api/chat`
- `POST /api/chat/stream`
- `GET /api/events` (SSE)
- `WS /ws/events?token=<local-token>`

## Model providers

The common model interface supports OpenAI-compatible APIs, Anthropic, Azure OpenAI, Alibaba Bailian and local OpenAI-compatible servers. Provider metadata is stored in SQLite; API keys are stored by `credential-provider`.

## Work memory

Projects are scanned with directory discovery and Git commands, not Git hooks. WorkCopilot stores factual snapshots separately from semantic or report output and can create daily, weekly, quarterly and yearly reports.

## Business workflow examples

`examples/workflows` contains parameterized templates for:

- Zentao login
- Webmail search
- OA form submission

They demonstrate the generic Workflow and credential abstractions and intentionally do not target a real enterprise deployment. Record a new workflow against the actual system instead of editing generated scripts.

## Quality checks

```powershell
pnpm typecheck
pnpm test
pnpm build
cargo check --manifest-path apps/desktop-agent/src-tauri/Cargo.toml
```

The deterministic login fixture is under `tests/fixtures`. The browser E2E test verifies Workflow DSL → Tool Registry → Playwright → successful login.

## Package boundaries

- `agent-core`: Hono API, agent loop and repositories
- `tool-registry`: validated tool contracts and dispatch
- `workflow-engine`: step orchestration and lifecycle
- `browser-recorder`: raw browser event to Workflow DSL conversion
- `playwright-runtime`: the only package allowed to import Playwright
- `credential-provider`: local secret storage
- `git-analyzer`: factual Git scanning
- `memory-engine`: raw, semantic and summary memory helpers
- `model-provider`: Vercel AI SDK provider abstraction
- `feishu-adapter`: Feishu and Markdown export tools

Workflow editing, cloud sync, multi-user accounts and a cloud backend are intentionally out of scope for v0.1.
