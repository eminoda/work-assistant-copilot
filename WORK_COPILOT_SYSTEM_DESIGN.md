# WorkCopilot System Design

## AI Worker Assistant Runtime

Repository:

work-assistant-copilot

Version:

v0.1 MVP

---

# 1. Product Overview

## 1.1 Product Name

Product:

WorkCopilot

Full Name:

AI Worker Assistant Runtime

Repository:

work-assistant-copilot

---

## 1.2 Product Vision

WorkCopilot 是面向软件开发人员的个人 AI 工作助手。

它不是传统自动化工具，而是一个具备：

- Browser Capability
- Workflow Automation
- AI Reasoning
- Personal Work Memory

能力的本地 AI Worker Runtime。

核心理念：

让 AI 理解用户工作环境，并帮助用户执行重复工作、记录工作过程、沉淀个人知识。

---

# 2. Background and Problems

## 2.1 Enterprise Application Operation Problem

企业内部通常存在大量业务系统：

例如：

- 禅道
- 邮箱
- OA
- 项目管理系统
- 内部管理平台

用户每天需要：

1. 打开统一入口平台
2. 输入账号密码
3. 等待登录
4. 查找应用
5. 点击进入

由于：

- Session 超时
- 应用数量多
- 登录流程重复

导致大量低价值操作。

WorkCopilot 通过 Browser Agent 自动完成。

目标：

用户点击：

"打开禅道"

即可：

- 自动登录
- 自动进入目标页面
- 执行业务操作

---

## 2.2 Developer Work Memory Problem

软件开发人员每天产生大量碎片化工作：

- 修改代码
- 修复 Bug
- 技术调研
- 需求开发
- 文档编写

但是：

- 工作过程没有沉淀
- 周报依靠最后一天回忆
- 季度总结缺少事实依据

WorkCopilot 建立 Personal Work Memory。

通过：

- Git Scanner
- File Scanner
- User Input
- AI Summary

自动形成：

- Daily Memory
- Weekly Report
- Quarterly Summary
- Year Summary

---

# 3. Product Positioning

WorkCopilot 定位：

AI Worker Assistant Runtime

类似：

- Cursor Agent
- Claude Desktop
- OpenAI Operator

但重点面向：

软件开发工作场景。

---

# 4. Core Capabilities

## 4.1 Browser Agent

负责：

浏览器自动执行。

能力：

- 用户行为录制
- DOM分析
- Workflow生成
- Playwright执行

典型场景：

- 自动登录
- 查询任务
- 创建邮件
- 填写表单
- 数据采集

---

## 4.2 Personal Work Memory

负责：

工作过程记录。

能力：

- Git项目扫描
- Diff分析
- 工作事项记录
- AI总结

---

## 4.3 AI Work Assistant

未来能力：

用户：

"帮我总结今天工作"

Agent：

自动：

- 查询Git变化
- 查询任务
- 查询记录
- 生成总结

---

# 5. System Architecture

整体架构：

User

↓

Chrome Extension

↓

HTTP / SSE / WebSocket

↓

WorkCopilot Agent Runtime

↓

+-------------------------+

|                         |

Workflow Engine      Memory Engine

|                         |

Tool Registry       Knowledge Store

|

+-------------+------------+------------+

|             |            |            |

Browser       Git         File       Feishu

---

# 6. Architecture Principles

## Principle 1

AI 不直接操作底层能力。

禁止：

AI -> Playwright Script

采用：

AI

↓

Workflow

↓

Tool

↓

Runtime

原因：

- 可维护
- 可扩展
- 可调试
- 可观测

---

## Principle 2

所有能力必须 Tool 化。

例如：

浏览器：

browser.open

browser.click

browser.input

browser.execute

Git：

git.scan

git.diff

git.summary

文件：

file.read

file.write

---

## Principle 3

事实和总结分离。

错误：

Git Diff

↓

AI

↓

周报

正确：

Git Diff

↓

Work Memory

↓

AI Summary

↓

Weekly Report

---

# 7. Technical Stack

## 7.1 Monorepo

使用：

- pnpm workspace
- Turborepo

原因：

- 多package管理
- 共享类型
- 统一构建

---

# 7.2 Frontend

## Chrome Extension

技术：

- Vue3
- TypeScript
- Vite

职责：

- 浏览器交互
- DOM采集
- UI展示
- Agent通信

---

## Desktop UI

技术：

- Vue3
- TypeScript

职责：

- 设置页面
- Workflow管理
- AI配置
- 日志查看

---

# 7.3 Desktop Runtime

技术：

Tauri v2

职责：

- 跨平台桌面应用
- 生命周期管理
- 系统托盘
- Agent Runtime启动

注意：

Desktop不是业务核心。

它是：

Agent Host。

---

# 7.4 Agent Runtime

技术：

Node.js

Framework:

Hono

职责：

提供：

- HTTP API
- SSE Streaming
- WebSocket事件

运行：

localhost service

---

为什么不用 Next.js：

WorkCopilot不是Web应用。

不需要：

- SSR
- React Server Component
- 页面路由

需要：

- API Server
- Streaming
- Tool Runtime

因此：

Node.js + Hono 更适合。

---

# 7.5 AI Framework

技术：

Vercel AI SDK

能力：

- Model Provider
- generateText
- streamText
- Tool Calling

运行环境：

Node.js

不依赖Next.js。

---

# 7.6 Browser Automation

技术：

Playwright

职责：

Workflow执行。

注意：

Playwright只是Runtime。

不是业务逻辑。

---

# 7.7 Database

Database:

SQLite

ORM:

Prisma

原因：

- 本地应用
- 数据量有限
- Schema维护简单

---

# 7.8 Validation

Zod

用途：

- Tool输入输出
- Workflow Schema
- API参数

---

# 8. Repository Structure

work-assistant-copilot

apps

├── chrome-extension

└── desktop-agent

packages

├── agent-core

├── tool-registry

├── workflow-engine

├── browser-recorder

├── playwright-runtime

├── memory-engine

├── git-analyzer

├── model-provider

├── credential-provider

└── feishu-adapter

---

# 9. Application Design

# 9.1 chrome-extension

## Responsibility

浏览器能力入口。

负责：

- 页面监听
- DOM采集
- 用户操作录制
- Side Panel UI
- Agent通信

---

## UI Design

采用：

Browser Side Panel

结构：

Business Website

右侧：

WorkCopilot Panel

第一阶段：

展示：

- 自动登录
- 执行Workflow
- 工作记录

未来：

支持：

AI Chat

---

## Communication

Extension

↓

HTTP

↓

Agent Runtime

Streaming:

SSE

实时事件:

WebSocket

---

# 9.2 desktop-agent

## Responsibility

WorkCopilot宿主。

负责：

- Tauri窗口
- 系统托盘
- Agent生命周期

---

## Runtime Lifecycle

启动：

用户打开WorkCopilot

↓

Tauri启动

↓

启动Agent Runtime

↓

监听localhost端口

---

关闭窗口：

隐藏窗口

保持后台运行

---

退出：

系统托盘

↓

退出WorkCopilot

↓

关闭Agent Runtime

---

# 9.3 agent-core

核心Agent模块。

职责：

- Prompt管理
- Context管理
- Model调用
- Agent Loop

结构：

agent-core

├── agent

├── context

├── prompt

└── model

---

# 9.4 tool-registry

所有工具统一注册中心。

接口：

Tool

{

name

description

inputSchema

outputSchema

execute()

}

示例：

browser.login

browser.execute

git.scan

file.save

credential.get

---

# 9.5 workflow-engine

Workflow执行引擎。

职责：

- Workflow加载
- Step执行
- 状态管理
- 错误处理

执行：

Workflow

↓

Step

↓

Tool

↓

Result

---

# 9.6 browser-recorder

用户操作录制。

采集：

- URL
- DOM
- Selector
- HTML Snapshot
- 用户操作
- 输入行为

不会直接生成JS。

流程：

Raw Event

↓

Element Snapshot

↓

Workflow DSL

---

# 9.7 playwright-runtime

负责：

Workflow执行。

输入：

Workflow JSON

输出：

Execution Result

---

# 9.8 memory-engine

负责：

个人工作记忆。

数据来源：

- Git
- File
- User Input

输出：

- Daily Memory
- Weekly Summary

---

# 9.9 git-analyzer

扫描工作目录。

不采用Git Hook。

采用：

Directory Scanner

流程：

Workspace

↓

mtime过滤

↓

git status

↓

git diff

↓

AI分析

---

# 9.10 model-provider

统一模型抽象。

支持：

- OpenAI Compatible
- Azure OpenAI
- Anthropic
- Alibaba Bailian

配置：

provider

baseURL

apiKey

model

---

# 9.11 credential-provider

负责：

凭据管理。

MVP:

本地存储。

接口：

save()

get()

remove()

未来：

支持：

- Windows Credential Manager
- Mac Keychain
# 10. Agent Architecture Design

## 10.1 Agent Runtime Overview

Agent Runtime 是 WorkCopilot 的核心执行环境。

职责：

- 接收用户请求
- 理解用户意图
- 调用 Tool
- 编排 Workflow
- 返回执行结果

整体流程：

User Intent

↓

Agent

↓

Planner

↓

Workflow

↓

Tool Registry

↓

Runtime

---

# 10.2 Agent Execution Model

WorkCopilot 不采用：

LLM直接生成代码执行。

禁止：

User

↓

LLM

↓

JavaScript

↓

Execute

原因：

- 不稳定
- 难审计
- 难恢复
- 安全风险高

---

采用：

User

↓

LLM Reasoning

↓

Workflow Plan

↓

Tool Calling

↓

Execution

---

# 10.3 Agent Loop

标准流程：

1. 接收用户输入

例如：

"帮我打开禅道"

2. Intent识别

识别：

intent:

browser.workflow.execute

3. 查询Workflow

找到：

zentao-login

4. 调用Tool

例如：

browser.execute

5. 返回状态

例如：

登录成功

---

# 11. Tool Registry Design

## 11.1 Tool Concept

Tool 是 WorkCopilot 最小执行能力单元。

每个 Tool：

必须具备：

- name
- description
- input schema
- output schema
- execute function

---

## 11.2 Tool Example

browser.open

Input:

{
 url:string
}

Output:

{
 success:boolean
 page:string
}

---

browser.click

Input:

{
 target:ElementSnapshot
}

Output:

{
 success:boolean
}

---

git.scan

Input:

{
 path:string
}

Output:

{
 files:number
 changes:[]
}

---

# 11.3 Initial Tool List

## Browser Tools

browser.open

browser.close

browser.click

browser.input

browser.extract

browser.snapshot

browser.executeWorkflow

---

## Recorder Tools

recorder.start

recorder.capture

recorder.stop

recorder.optimize

---

## Workflow Tools

workflow.create

workflow.load

workflow.execute

workflow.delete

---

## Credential Tools

credential.save

credential.get

credential.remove

---

## Git Tools

git.scan

git.status

git.diff

git.summary

---

## File Tools

file.read

file.write

file.search

---

## Export Tools

feishu.export

markdown.export

---

# 12. Workflow Design

## 12.1 Why Workflow DSL

Workflow 是：

AI 和 Runtime之间的协议层。

优势：

- 可持久化
- 可调试
- 可执行
- 可迁移

---

# 12.2 Workflow Lifecycle

用户录制：

↓

Raw Recording

↓

AI优化

↓

Workflow DSL

↓

保存

↓

执行

---

# 12.3 Workflow Storage

存储：

SQLite

字段：

id

name

intent

description

steps

createdAt

updatedAt

---

# 12.4 Workflow Example

自动登录：

{
"name":"zentao-login",

"intent":"browser.login",

"steps":[

 {

 "tool":"browser.open",

 "params":{

 "url":"https://zentao.com"

 }

 },

 {

 "tool":"credential.get",

 "params":{

 "key":"zentao.account"

 }

 },

 {

 "tool":"browser.input",

 "params":{

 "target":"username"

 }

 },

 {

 "tool":"browser.click",

 "params":{

 "target":"login-button"

 }

 }

]

}

---

# 12.5 Workflow Editing Strategy

MVP阶段：

Workflow只读。

用户修改：

删除旧Workflow

↓

重新录制

原因：

避免开发：

- Workflow Builder
- 节点编辑器
- 条件分支

---

# 13. Browser Recorder Design

## 13.1 Recorder Goal

记录：

用户如何完成任务。

不是：

记录脚本。

---

# 13.2 Recording Data

保存：

## Basic Information

url

title

timestamp

---

## User Action

click

input

navigation

submit

---

## Element Information

Raw Selector:

例如：

#submit

HTML Snapshot:

<button>

登录

</button>

DOM Path

Attributes

Text

Role

Placeholder

---

# 13.3 AI Optimization

输入：

Raw Recording

↓

AI分析

↓

Element Snapshot

↓

Workflow DSL

---

例如：

原始：

selector:

#btn123

优化：

{

role:"button",

text:"登录",

confidence:0.95

}

---

# 14. Playwright Runtime

## 14.1 Responsibility

Playwright Runtime负责：

执行Workflow。

---

# 14.2 Execution Flow

Workflow

↓

Workflow Engine

↓

Playwright Adapter

↓

Browser

↓

Result

---

# 14.3 Selector Strategy

执行优先级：

1. aria-label

2. role

3. text

4. placeholder

5. stable attribute

6. css selector

---

# 15. Memory Engine Design

## 15.1 Goal

建立用户工作记忆。

不是简单日志。

---

# 15.2 Memory Layer

三层设计：

## Raw Memory

事实数据。

例如：

2026-07-21

Project:

pooka

Changes:

- 修改CRUD组件
- 优化Schema

---

## Semantic Memory

AI理解后的知识。

例如：

完成后台CRUD自动生成能力优化。

---

## Summary Memory

输出：

日报

周报

季度总结

---

# 16. Daily Work Record

## 16.1 Input Source

来源：

1. 用户主动输入

2. Git扫描

3. 文件变化

---

# 16.2 Scanner Design

不采用：

Git Hook

原因：

- 配置复杂
- 用户体验差

采用：

Directory Scanner

流程：

workspace

↓

file mtime filter

↓

detect changed project

↓

git diff

↓

AI Summary

---

# 17. AI Model Configuration

## 17.1 Provider Architecture

统一接口：

ModelProvider

支持：

OpenAI Compatible

Anthropic

Azure OpenAI

Alibaba Bailian

Local Model

---

# 17.2 Configuration Example

{

"provider":

"openai-compatible",

"baseURL":

"https://api.xxx.com/v1",

"apiKey":

"sk-xxx",

"model":

"qwen"

}

---

# 17.3 Streaming

支持：

SSE:

用于：

AI Chat

WebSocket:

用于：

Agent执行事件

例如：

{

type:

"tool.progress",

message:

"正在执行登录"

}

---

# 18. Chrome Extension Communication API

## 18.1 HTTP API

POST:

/api/workflow/execute

Request:

{

workflowId:

"xxx"

}

Response:

{

executionId:

"xxx"

}

---

# 18.2 Streaming API

GET:

/api/chat/stream

返回：

AI Token Stream

---

# 18.3 Event API

WebSocket:

/ws/events

事件：

tool.started

tool.finished

workflow.failed

human.confirm.required

# 19. Database Design

## 19.1 Database Choice

Database:

SQLite

ORM:

Prisma

Reason:

WorkCopilot 是本地 Agent Runtime。

数据特点：

- 单用户
- 本地存储
- 数据量有限
- 强结构化

---

# 19.2 Core Tables

## UserSetting

保存用户配置。

字段：

id

key

value

createdAt

updatedAt

用途：

- AI Provider配置
- 工作目录配置
- 系统设置

---

## ModelProvider

保存AI模型配置。

字段：

id

name

providerType

baseUrl

apiKey

model

enabled

createdAt

updatedAt

示例：

{

name:

"Qwen"

providerType:

"openai-compatible"

baseUrl:

"https://xxx/v1"

model:

"qwen3"

}

---

# Workflow

保存自动化流程。

字段：

id

name

intent

description

steps(Json)

status

createdAt

updatedAt

steps保存Workflow DSL。

---

# Recording

保存录制历史。

字段：

id

name

intent

url

events(Json)

status

createdAt

updatedAt

---

# WorkflowExecution

保存执行记录。

字段：

id

workflowId

status

startedAt

finishedAt

result(Json)

error

状态：

PENDING

RUNNING

SUCCESS

FAILED

---

# CredentialMetadata

保存凭据元信息。

注意：

MVP阶段：

真实密码不进入数据库。

字段：

id

name

provider

key

createdAt

---

# Project

保存工作项目。

字段：

id

name

path

gitUrl

createdAt

---

# GitSnapshot

保存Git分析结果。

字段：

id

projectId

commitHash

changes(Json)

summary

createdAt

---

# DailyMemory

保存每日工作记录。

字段：

id

date

content

source

metadata(Json)

source:

USER

GIT

FILE

---

# WeeklyReport

保存总结。

字段：

id

startDate

endDate

content

createdAt

---

# 20. Agent Runtime API Design

## 20.1 Health Check

GET

/api/health

Response:

{

status:

"ok"

}

---

# 20.2 Workflow Execute

POST

/api/workflow/execute

Request:

{

workflowId:

"workflow-id"

}

Response:

{

executionId:

"xxx"

}

---

# 20.3 Workflow Status

GET

/api/workflow/execution/:id

Response:

{

status:

"RUNNING"

progress:

[

"open page",

"input username",

"click login"

]

}

---

# 20.4 Chat API

POST

/api/chat

Request:

{

messages:[]

}

内部：

调用：

Vercel AI SDK streamText

返回：

SSE

---

# 20.5 Recorder API

POST

/api/recording/create

Request:

{

name:

"zentao login",

events:[]

}

处理：

Agent优化

↓

Workflow生成

---

# 21. Security Design

## 21.1 Credential

MVP:

简单本地存储。

目录：

~/.workcopilot

结构：

credentials

workflows

memory

logs

---

未来：

Credential Provider抽象：

LocalProvider

↓

OS Keychain Provider

---

# 21.2 Local API Security

Agent Runtime只监听：

127.0.0.1

禁止：

0.0.0.0

---

Extension通信：

增加：

token验证

例如：

Authorization:

Bearer local-token

---

# 22. MVP Development Plan

## Phase 0

项目初始化。

目标：

完成：

- Monorepo
- Tauri
- Vue3
- Hono Agent Runtime
- Prisma SQLite

---

## Phase 1

Browser Automation MVP

目标：

完成：

自动登录闭环。

流程：

Chrome Extension

↓

Recorder

↓

Workflow DSL

↓

Playwright

↓

登录成功

---

### Features

实现：

1. Extension Side Panel

2. Recorder

3. Element Snapshot

4. Workflow保存

5. Playwright执行

6. Execution日志

---

## Phase 2

Developer Memory MVP

目标：

自动生成每日工作记录。

实现：

配置workspace目录

↓

Scanner

↓

Git Diff

↓

AI Summary

↓

Daily Memory

---

## Phase 3

AI Work Assistant

增加：

Chat入口

支持：

用户：

"帮我总结今天工作"

Agent:

调用：

git.scan

memory.query

summary.generate

---

## Phase 4

Business Agent

支持：

- 禅道
- 邮箱
- OA

通过Workflow扩展。

---

# 23. AI IDE Development Rules

以下规则必须遵守。

---

# Rule 1

不要让AI直接生成业务脚本。

禁止：

LLM

↓

JavaScript

必须：

LLM

↓

Workflow DSL

↓

Tool

---

# Rule 2

所有能力必须模块化。

禁止：

在Route中直接实现业务逻辑。

错误：

POST /login

里面：

Playwright代码

正确：

API

↓

Agent

↓

Tool

---

# Rule 3

保持Package独立。

例如：

Playwright能力：

只能存在：

playwright-runtime

不能散落：

extension

agent-core

---

# Rule 4

所有输入输出必须Zod校验。

例如：

Tool Input

↓

Zod

↓

Execute

---

# Rule 5

优先实现MVP闭环。

不要提前开发：

- Workflow编辑器
- 企业账号系统
- 云同步
- 多用户

---

# 24. Initial AI IDE Prompt

Create a monorepo project named:

work-assistant-copilot

using:

- pnpm workspace
- Turborepo
- Vue3
- TypeScript
- Tauri v2
- Hono
- Vercel AI SDK
- Prisma
- SQLite
- Playwright
- Zod

Project structure:

apps:

- chrome-extension

- desktop-agent

packages:

- agent-core

- workflow-engine

- tool-registry

- browser-recorder

- playwright-runtime

- memory-engine

- git-analyzer

- model-provider

- credential-provider

- feishu-adapter

Implementation priority:

Phase 1:

Implement Browser Automation MVP.

Need:

1. Chrome Extension Side Panel

2. Browser Recorder

3. Recording Storage

4. Workflow DSL

5. Workflow Engine

6. Playwright Runtime

7. Agent Runtime API

Do not implement:

- Workflow editor

- Cloud backend

- Multi-user

- Complex permission system

Architecture requirement:

AI must interact with tools through Tool Registry.

Workflow is the intermediate abstraction layer.

Playwright is only execution runtime.
