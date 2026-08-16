# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

本地运行的 LLM API Key 管理工具：集中保存各供应商的 API Key / Base URL，一键测试连通性、复制 Key/URL、生成 curl / Python 调用代码。**零第三方依赖**，仅用 Node.js 内置模块（`http`、`fs`、`crypto`），前端为原生 JS。

## 运行与开发命令

无 `package.json`，**无需 `npm install`**，也没有构建 / lint / 测试框架。需要 Node.js 18+（依赖内置 `fetch`）。

```bash
node server.js            # 启动服务，默认 http://127.0.0.1:3210
# 或 Windows 下双击 start.bat（自动打开浏览器）、stop.bat（按端口杀进程）
```

辅助脚本（直接用 node 运行，非测试框架）：

```bash
node tests/mock-openai.js   # 启动模拟 OpenAI 服务 http://127.0.0.1:3299，有效 Key: sk-valid-123
node tests/check-ids.js     # 校验 app.js 中 $('xxx') 引用的 DOM id 是否都存在于 index.html
```

环境变量：`KV_PORT`（默认 `3210`）、`KV_HOST`（默认 `127.0.0.1`）、`KV_DATA_FILE`（默认 `./data/keys.json`）。

## 工作流约定

- 开发在 `dev` 分支上进行，`main` 保持稳定；功能稳定后合并回 `main`。
- **每次任务完整完成（改动 + 验证通过）后，自动执行 `git add -A`、`git commit`（中文说明，带 `Co-Authored-By` 署名）并 `git push` 到远程当前分支，无需等待用户再次确认。**

## 架构

前后端通过 HTTP JSON API 通信，所有 `/api/*` 路由由 [server.js](server.js) 处理，其余路径由 `serveStatic` 从 `public/` 提供静态文件。

**后端 [server.js](server.js)（单文件，约 490 行）**核心职责分四块：

1. **存储与加密** — `state` 对象持有内存态（`entries` 解密后的条目数组、`masterPassword`、`encrypted` 标志）。数据落盘在 `data/keys.json`；`saveFile` 先写 `.tmp` 再 `rename` 实现原子写入。加密为 AES-256-GCM + scrypt（`SCRYPT_N = 2**14`），主密码只存内存从不落盘，`isLocked()`/`requireUnlocked()` 控制加密态下的访问（返回 HTTP 423）。
2. **连通性测试代理** — `buildTestRequests(entry)` 按 `entry.provider` 生成候选请求列表，`runTest` 逐个尝试：OpenAI 兼容用 `Bearer` + `GET /models`（自动尝试 `/v1` 变体）、Anthropic 用 `x-api-key` + `anthropic-version`、Gemini 用 URL 查询参数带 Key、`custom` 用 `testConfig` 自定义。用 `AbortController` 实现 15s 超时；401/403 判定为 Key 无效即返回，404/405 继续试下一候选地址。测试由后端发起以规避浏览器 CORS。
3. **条目 CRUD 与校验** — `sanitizeEntry(raw, existing)` 是唯一入口，负责字段清洗（截断、`normalizeBaseUrl` 强制 http/https、默认名「未命名」）并抛中文错误。`/api/entries` 用 `unshift` 新条目到数组头部。
4. **主密码管理** — `/api/unlock`、`/api/lock`、`/api/password`（开启/修改/关闭加密）。

**前端 `public/`**：[app.js](public/app.js) 用原生 DOM 操作（`$` 按 id 取元素、`esc` 做 HTML 转义、`render` 全量重建卡片列表），无框架无构建。关键约定：

- `PROVIDERS` 映射供应商 → 标签/颜色/默认 Base URL；`TYPE_BY_PROVIDER` 把供应商归类到服务端测试类型（多数归为 `openai` 兼容）。
- `buildSnippets(entry)` 和 `chatUrl(entry)` 按供应商生成代码片段与完整调用地址。
- 测试结果写入 `entry.lastTest`（服务端在 `/api/test` 带 `id` 时持久化）。

## 关键约定与注意点

- **错误信息与 UI 文案均为中文**，新增功能时保持一致。
- **供应商列表在前后端各有一份**：新增供应商需同步修改 [app.js](public/app.js) 的 `PROVIDERS` / `TYPE_BY_PROVIDER`，以及 [server.js](server.js) 的 `buildTestRequests`（仅当测试方式非 OpenAI 兼容时才需改后端）。
- 所有对外请求统一带 `User-Agent: llm-key-vault` 头。
- 条目 `id` 由 `crypto.randomBytes(8).toString('hex')` 生成。
- 服务只监听 `127.0.0.1`，不对外开放；数据默认明文，建议用户开启主密码加密（忘记密码无法恢复）。
