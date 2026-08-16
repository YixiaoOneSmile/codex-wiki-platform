# 使用指南

本文面向希望在本地体验、二次开发或部署 Codex Wiki Platform 的用户。平台由 Web、API、
PostgreSQL 和 Crawl4AI 四个主要服务组成；DeepSeek 密钥只保存在服务端。

## 1. 环境要求

- Node.js 22 或更高版本
- Docker Engine / Docker Desktop 与 Docker Compose
- 官方 `codex` CLI
- DeepSeek API Key（真实模型对话和自然语言任务需要）

## 2. 本地完整启动

复制开发配置：

```sh
cp .env.example .env
```

在 `.env` 中填写 `DEEPSEEK_API_KEY`。开发环境中的 `SESSION_SECRET`、内部代理令牌和数据库密码
也建议替换，但不得把修改后的 `.env` 提交到 Git。

启动完整服务：

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build -d
```

首次本地体验可以创建演示账号：

```sh
docker compose exec api node packages/database/dist/seed.js
```

浏览器打开 `http://localhost:8080`，使用：

```text
邮箱：owner@example.com
密码：ChangeMe123!
```

该账号仅供本地开发。生产环境必须使用 `db:bootstrap` 创建首个管理员，并在首次登录后修改临时密码。

## 3. 对话与 Wiki 引用

登录后进入对话主页，直接输入问题即可。系统会在当前用户有权访问的团队 Wiki 和个人 Wiki 中
查找相关页面，并把命中的完整 Markdown 页面交给 Agent。回答中会展示：

- 是否调用了知识库；
- 检查和命中的页面数量；
- 引用的页面标题与所属空间；
- 可点击的参考资料入口。

知识库正文属于参考资料，不能覆盖系统指令或扩大用户权限。

## 4. 管理知识库

侧边栏进入“知识库”：

1. 选择团队知识或个人知识；
2. 新建 Markdown 页面，或导入受支持的文档；
3. 编辑标题与正文并保存；
4. 通过搜索框直接匹配标题和正文；
5. 在对话中询问页面内容，检查调用过程和引用来源。

组织管理员可以决定是否允许成员创建个人知识库。团队知识权限分为“可编辑”和“仅使用”；
最终授权由 API 执行，界面隐藏不等于权限控制。

## 5. 组织与成员

“组织设置”中可以配置组织显示名称、个人 Wiki 策略、成员和团队知识权限。只有平台超级管理员可以
创建新组织；组织所有者或管理员只能管理自己组织内的成员和策略。

新增成员时需要设置临时密码。新成员第一次登录必须修改密码，之后才能使用其他产品功能。

## 6. Skill

组织管理员可以在组织设置中配置 Skill。启用后，服务端只把当前组织允许使用的 Skill 说明注入
Agent，不读取其他组织的配置。建议先用低风险、只读型 Skill 验证，再逐步增加有副作用的能力。

## 7. 定时网页采集

进入“定时任务”，可以选择：

- 一句话创建，例如“每天上午 9 点抓取 https://example.com/news 并保存正文”；
- 手动设置任务名称、网址、首次执行时间和处理要求；
- 单次、每天、每周、每月或固定分钟/小时/天间隔；
- 暂停、恢复或结束周期任务；
- 查看每一次独立执行记录和 Markdown 结果。

Crawl4AI 只能抓取允许公开访问的 HTTP/HTTPS 地址。平台会拒绝本机、内网和保留地址；目标网站的
反自动化保护仍可能导致抓取失败，这种情况下应优先使用网站公开 RSS、API 或获授权的数据源。

## 8. 日志与用量

平台按组织、用户、会话和模型请求记录 Token 用量与估算成本。审计日志记录权限、配置和关键操作，
行为事件只保留白名单字段；默认不保存密码、密钥、完整提示词或完整知识正文。

## 9. 常用检查

查看容器状态：

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml ps
```

运行完整代码检查：

```sh
npm install
npm run check
```

停止服务：

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml down
```

`down` 默认不会删除持久化 volume。不要使用 `down -v`，除非已经确认可以永久删除本地数据库和
Wiki 数据。

## 10. 生产部署

生产环境不要使用 `docker-compose.dev.yml`。请继续阅读：

- [服务器部署与运维](deployment.md)
- [架构基线](architecture.md)
- [安全基线](security.md)
- [许可证与代码来源](licensing.md)
