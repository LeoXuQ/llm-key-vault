# LLM API Key Vault

一个本地运行的 LLM API Key 管理工具：集中保存你的各个大模型 API Key 和 Base URL，
一键测试连通性验证 Key 是否有效，需要用时一键复制 Key / URL，或直接生成 curl / Python 调用代码。

## 快速开始

```bash
# 方法一：双击 start.bat（Windows）
# 方法二：命令行
node server.js
```

然后在浏览器打开 **http://127.0.0.1:3210**

> 需要 Node.js 18+（自带 fetch，无任何第三方依赖，无需 npm install）

## 功能

- **添加 / 编辑 / 删除**：名称、供应商（含 OpenAI / DeepSeek / Claude / Gemini / Kimi / 通义 / 智谱 / 硅基流动等预设）、Base URL、API Key、默认模型、备注
- **测试连通性**：一键测试，自动判断 Key 是否有效；失败时显示 HTTP 状态码、耗时、响应内容（便于排查）
- **多种接口格式**：
  - OpenAI 兼容（`Authorization: Bearer` + `GET /models`，自动尝试 `/v1` 变体）
  - Anthropic Claude（`x-api-key` + `anthropic-version` 头）
  - Google Gemini（URL 查询参数携带 Key）
  - 自定义请求（可配置方法 / 路径 / 鉴权方式 / 额外请求头 / 请求体）
- **一键复制**：API Key、Base URL、完整调用地址
- **代码片段**：按供应商生成 curl、Python (openai SDK / requests / anthropic SDK / google-genai) 示例，一键复制
- **搜索过滤**：按名称 / URL / 备注搜索，按供应商过滤
- **主密码加密**（可选）：开启后数据文件以 AES-256-GCM + scrypt 加密保存，
  打开页面需输入主密码解密；可随时锁定（清除内存中的密钥）。忘记密码无法恢复数据。
- 测试请求由本地后端转发，规避浏览器跨域（CORS）限制

## 数据与安全

- 数据文件：`data/keys.json`（可用环境变量 `KV_DATA_FILE` 修改路径）
- 默认**明文模式**；建议在「🔐 主密码设置」中开启加密
- 服务只监听 `127.0.0.1`，不对外开放；主密码只保存在内存中，从不落盘
- 服务仅在你运行它时可用，关闭窗口即停止

## 配置

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `KV_PORT` | `3210` | 监听端口 |
| `KV_HOST` | `127.0.0.1` | 监听地址 |
| `KV_DATA_FILE` | `./data/keys.json` | 数据文件路径 |

## 项目结构

```
llm-key-vault/
├── server.js          # 本地服务：存储 / 加密 / 测试代理 API
├── public/
│   ├── index.html     # 页面
│   ├── style.css      # 样式
│   └── app.js         # 前端逻辑
├── data/keys.json     # 数据文件（运行时生成）
└── tests/mock-openai.js  # 测试用的模拟 OpenAI 服务（仅开发用）
```

## 常见问题

- **测试显示 401/403**：API Key 无效或已过期
- **测试超时**：网络不通或服务地址错误，可检查 Base URL 是否能直接访问
- **忘记主密码**：数据无法恢复，只能删除 `data/keys.json` 重新开始
- **想换端口**：`set KV_PORT=4000` 后再 `node server.js`
