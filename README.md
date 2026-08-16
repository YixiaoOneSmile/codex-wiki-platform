# Codex Wiki Platform

面向普通用户的轻量多租户 AI 助手平台。它以官方 Codex `app-server` 作为 Agent
执行内核，使用平台统一配置的 DeepSeek 密钥，并将组织与个人知识维护为可读、可追踪的
Markdown Wiki，而不是向量数据库或切片检索。

> 当前处于开发阶段。安全隔离、真实 DeepSeek 链路和服务器部署全部通过验收前，不应暴露到公网。

## 目标能力

- 组织、成员、角色与组织级显示名称
- 团队 Wiki / 个人 Wiki，以及组织策略与编辑/使用权限
- ChatGPT 风格的克制浅色对话界面
- Codex `app-server` 驱动的流式 Agent 会话、Skill 和受限文件操作
- 一次性与周期定时任务：支持手动配置，或在对话中用自然语言创建网页采集任务
- 独立 Crawl4AI 服务抓取公开网页，并将结果保存为可阅读的 Markdown
- 按组织、用户、会话和请求统计模型用量与成本
- 错误、审计和基础行为事件日志，默认不记录密钥和完整提示词

## 开发环境

需要 Node.js 22+、Docker Compose 和官方 `codex` CLI。复制 `.env.example` 为
`.env`，启动 PostgreSQL 后安装依赖并迁移数据库：

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

Web 默认为 `http://localhost:5173`，API 默认为 `http://localhost:4100`。

定时任务依赖 Crawl4AI。完整容器模式会自动启动它；仅运行本地 API 时，需要另外提供
`CRAWL4AI_URL` 和 `CRAWL4AI_API_TOKEN`。当前版本支持单次、每天、每周、每月和固定间隔
执行，并为每次执行保存独立记录；不包含 Hook 或可视化工作流。

详细设计和安全边界见 [docs/architecture.md](docs/architecture.md) 与
[docs/security.md](docs/security.md)。

## 完整容器启动

本地验证完整服务器形态：

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build -d
```

访问 `http://localhost:8080`。生产环境必须替换全部示例密码并在受信任的 HTTPS 反向代理
后运行，具体见 [docs/deployment.md](docs/deployment.md)。

首次启动会下载包含 Chromium 的 Crawl4AI 镜像，因此体积和耗时明显高于普通 Web/API
镜像。该服务仅位于容器内部网络，不向宿主机公开端口；API 会在任务到点后调用它，并把
Markdown 结果、执行状态和必要错误信息写入数据库。

`db:seed` 只创建本地演示账号，不得用于生产。服务器首次管理员由 `db:bootstrap`（或部署文档
中的容器命令）创建，且会在首次登录强制修改临时密码。
