# 服务器部署与运维

## 首次部署

1. 服务器安装 Docker Engine 与 Compose 插件，防火墙仅开放反向代理的 80/443。
2. 将项目放在服务器私有目录，复制 `.env.production.example` 为 `.env`。
3. 分别生成数据库密码、`SESSION_SECRET`、`AGENT_PROXY_TOKEN`、`CRAWL4AI_API_TOKEN` 和 `CRAWL4AI_SECRET_KEY`；将数据库密码 URL 编码后写入 `DATABASE_URL_DOCKER`。爬虫令牌与签名密钥至少使用 32 个随机字符，并与模型密钥分开。
4. 将 DeepSeek 密钥放入服务器密钥管理或仅管理员可读的 `.env`，权限设置为 `0600`。
5. 将 `WEB_ORIGIN` 改为最终 HTTPS 域名，执行 `docker compose up --build -d`。
6. API healthy 后执行 `docker compose exec api node packages/database/dist/bootstrap.js`，创建首个组织与所有者。该命令可重复检查但不会覆盖既有账号；首次登录必须修改临时密码。完成后从 `.env` 删除五个 `BOOTSTRAP_*` 值并重启 API，避免临时密码长期留在服务器。
7. 检查 `docker compose ps`，API、数据库与 Crawl4AI 必须为 healthy，再通过浏览器完成登录、Wiki、Skill、定时抓取和真实模型冒烟测试。

Codex Harness 无需预先安装在宿主机。API 镜像会读取仓库根目录 `.codex-version`，安装并验证对应的
官方 `@openai/codex` 精确版本；不要在生产构建时替换为 `latest`。

Web 容器监听宿主机 8080。使用 Caddy、Nginx 或云负载均衡将 HTTPS 域名转发到
`127.0.0.1:8080`。不要直接暴露 PostgreSQL、API 4100、Crawl4AI 11235 端口或 `/internal` 路径。

## 定时抓取

API 进程负责轮询和领取到期任务，Crawl4AI 容器负责实际打开网页并生成 Markdown。任务支持
单次、每天、每周、每月和固定间隔执行；每次执行都写入独立运行记录，周期任务会计算下一次计划
时间，服务恢复后不会补跑全部错过的周期。可通过 `APP_TIMEZONE` 指定自然语言时间解释所用时区，
通过 `SCHEDULER_POLL_MS` 调整轮询间隔。

Crawl4AI 保持根文件系统只读，只为 Chromium 配置、Crawl4AI 缓存、Gunicorn 状态和 `/tmp`
提供临时写入目录。内置 Redis 只承担短期任务协调，已关闭 RDB/AOF 持久化；业务任务和结果
仍由 PostgreSQL 持久化。不要删除 `infra/crawl4ai/supervisord.conf` 的挂载，否则 Redis 会
尝试向只读 `/app` 写快照，Chromium 也可能因缺少可写配置目录而在启动时退出。

系统会拒绝本机、内网、保留地址和无法安全解析的目标网址，并在创建与执行时都做检查。
生产环境仍应在基础设施层限制 Crawl4AI 容器访问内部网段，避免仅依赖应用层校验。任务失败后
会保留简化错误；只有浏览器启动即退出时会自动重试一次，网站拒绝访问、地址错误等业务失败
不会重试。管理员可从日志结合任务 ID 排查。

开发覆盖文件为兼容 Docker Desktop 将公开域名映射到 `198.18.0.0/15` 的 DNS 代理行为，
只在 Crawl4AI 内部关闭重复的目标检查；API 层检查仍然生效。生产部署不要使用
`docker-compose.dev.yml`，也不要设置 `CRAWL4AI_ALLOW_INTERNAL_URLS=true`。

## 数据持久化与备份

业务数据库位于 `postgres-data` volume，Wiki 工作副本、导入文件和 Codex thread 位于
`app-data` volume。两者必须一起备份，才能保留可恢复的一致状态。

数据库逻辑备份示例：

```sh
docker compose exec -T postgres pg_dump -U codex -d codex_wiki -Fc > codex-wiki.dump
```

恢复属于会覆盖数据的操作：先停止写入、确认目标数据库和备份校验值，并取得人工批准后再执行。
`app-data` 使用宿主机或云平台的 volume 快照；快照前暂停 API 容器。

## 更新与回滚

更新前备份两个 volume，在隔离环境执行迁移和测试，然后重新构建镜像。数据库迁移只允许向前
执行；任何删除列、重写数据或批量删除必须单独设计可恢复方案并经人工批准。应用镜像可回滚，
数据库只能恢复到与该镜像兼容的备份。

如果更新包含 Codex Harness 版本变化，先查看官方 release notes，并在隔离环境运行：

```sh
npm ci
npm run check
npm run build
npm run codex:check
docker compose build api
```

其中 `.codex-version` 是唯一版本来源。协议检查、API 镜像构建和真实 DeepSeek 冒烟测试任一失败时，
不得部署或只通过降低测试标准继续。回滚应用时同时恢复该版本对应的 `.codex-version` 和镜像。

## 日志与隐私

API 输出结构化日志并使用 correlation ID；授权头、Cookie、密码和常见 API key 字段会脱敏。
审计日志记录权限/配置变更，行为事件只记录白名单事件名和有限属性，不默认保存完整提示词或页面正文。
根据组织合规要求设置数据库与容器日志的保留期限。

## Codex shell 与沙箱要求

默认保持 `AGENT_SHELL_ENABLED=false`。Wiki 查询会由平台按租户权限匹配并把完整 Markdown 原文
交给 Codex，组织 Skill 也由平台直接注入，因此普通对话不依赖 shell。标准非特权 Docker 容器
通常不能再嵌套 Codex 的 bubblewrap；不要用 `SYS_ADMIN`、`--privileged`、`seccomp=unconfined`
或 `danger-full-access` 解决。

如确实需要 Agent 操作文件，应先部署独立、每次运行隔离的 runner（只挂载该次会话目录，不挂载
API 密钥、数据库连接和其他租户 volume），完成越界读写与网络限制测试后才能将开关设为 `true`。
当前 Compose 不包含这种高权限 runner，因而生产默认不会放行 Agent shell。
