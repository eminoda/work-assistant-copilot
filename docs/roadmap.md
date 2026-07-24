# 路线图

对照 [vision.md](./vision.md) / [features.md](./features.md)。状态会随实现更新。

图例：✅ 已可用 · 🟡 部分可用 · ⬜ 未做 · ❌ 明确不做（当前阶段）

---

## 基础平台

| 项 | 状态 | 说明 |
|----|------|------|
| Monorepo + agent-core + SQLite | ✅ | `127.0.0.1` + Bearer token |
| Desktop 启停 Runtime / 托盘 | ✅ | Tauri 宿主 |
| 扩展连接 Settings（token） | ✅ | 齿轮设置页 |
| Desktop 已有 token 时自动连接 | ✅ | 启动重试直至 Runtime 就绪 |

---

## 录制与执行

| 项 | 状态 | 说明 |
|----|------|------|
| 录制 click / input / navigation / tab | ✅ | 扩展 content + background |
| 密码 → credential 引导 | ✅ | 停止录制后凭证弹窗 |
| 录制后命名 Workflow | ✅ | Rename 弹窗 |
| cookies / session 凭证 | 🟡 | 已采集与注入，复杂站点仍需打磨 |
| Playwright 回放 + 页面就绪等待 | 🟡 | 主链路可用，站点差异大 |
| 等待 URL 变化（二维码 / 短信） | 🟡 | 录制侧可插入 `waitNavigation`（90s）；回放工具已加 |
| 录制中标记文本 → 通知源 | 🟡 | 录制页「文字提取」+ 命名；通知通道仍未做 |
| Workflow 列表 Run / Delete / Delete all | ✅ | 扩展侧 |

---

## 工作流组合

| 项 | 状态 | 说明 |
|----|------|------|
| 单段 Workflow 存储与执行 | ✅ | 支持类型：登录 / 应用 |
| Cookie 变更 → credential 绑定 workflow | ✅ | 保存为 `.session`，执行时注入 |
| 登录类型：主页 + Cookie 短路 | ✅ | 不跳转则跳过完整回放 |
| 多段组装 + URL 接缝判定 | ⬜ | 核心产品方向，优先排期 |
| 可视化大编辑器 | ❌ | 当前不做；先轻量组合即可 |

---

## 消息通知

| 项 | 状态 | 说明 |
|----|------|------|
| 通知事项 / 文案 / 定时策略 | ⬜ | Desktop 调度 + 系统通知 |
| 与录制文本标记联动 | ⬜ | |

---

## 周报 / 工作记忆

| 项 | 状态 | 说明 |
|----|------|------|
| 项目注册 + Git 扫描 API | 🟡 | `git-analyzer` + store API 有雏形 |
| Desktop 配置工作目录 + 定时扫描 | ⬜ | |
| Raw diff 入库与列表 | 🟡 | memory API / 列表壳 |
| AI 分析 diff → 项目日总结 | ⬜ | 依赖模型配置与流水线 |
| 周报 / 年报汇总 | ⬜ | 在日报稳定后做 |

---

## AI 对话

| 项 | 状态 | 说明 |
|----|------|------|
| Desktop Chat 入口 + 简单对话 | 🟡 | 非完整工具循环 Agent |
| 「总结今日」类快捷意图 | 🟡 | 关键词走 memory 摘要 |
| 完整 Agent Loop（多工具多轮） | ⬜ | 不阻塞录制/组合/周报主线 |

---

## 明确后置

- 云同步、多用户、企业账号体系
- OS Keychain 抽象（MVP 继续用本地 credentials 目录）
- 让 LLM 直接生成并执行业务 JavaScript

---

## 建议下一迭代顺序

1. **工作流组合（URL 接缝）** — 解决「门户 → 业务系统」多跳而不录成长脚本  
2. **等待 URL / 人工介入节点** — 打通验证码类断点  
3. **工作目录 + 定时 Git 扫描 → raw 记忆** — 周报原料自动化  
4. **通知策略最小闭环** — Desktop 定时提醒  
5. **AI diff 日总结** — 在原料稳定后接入模型  
