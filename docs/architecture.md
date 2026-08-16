# 架构基线

## 信任边界

浏览器只连接平台 API，不直接接触 DeepSeek 密钥、Codex 进程或租户文件。API 从已验证的
服务器会话解析 `userId` 和 `orgId`，数据库查询必须显式带上组织范围。Agent 运行时只获得
当前组织专属工作目录和经过策略过滤的知识、Skill 与工具。

```text
Browser -> API/Auth -> PostgreSQL
                    -> Usage/Audit/Event logs
                    -> Agent runtime -> Codex app-server -> Responses adapter -> DeepSeek
                                     -> isolated org workspace / Markdown Wiki
```

## Wiki 模式

知识库不采用 embedding、向量数据库、切片或相似度召回。每个 Wiki 页面都保存标准 Markdown、
稳定路径、标题和页面关系。知识库界面使用 PostgreSQL 字符串全文匹配（可直接匹配中文）；每次
对话由服务端从当前用户有权访问的页面做词项匹配，将命中的完整 Markdown 页面作为 JSON 交给
Codex。页面正文被视为不可信参考资料，不能覆盖系统指令。页面编辑会产生版本，导入来源保存
原文件、校验值和来源信息。

## 数据所有权

所有业务实体均归属于组织。个人 Wiki 同时带 `ownerUserId`，但仍不能跨组织移动或读取。
对话与 Codex thread ID 的映射只保存在服务器端。组织切换会签发新的活动组织上下文，而不是
接受客户端传入任意组织 ID。

## 对话记忆与 Skill

消息历史、Codex thread ID 和运行记录持久化在组织范围内；同一对话恢复同一个 Codex thread，
形成会话记忆。组织 Skill 由管理员配置，服务端只加载当前组织已启用 Skill 的完整说明并交给
Codex，不读取其他组织配置。当前版本不把不同对话自动合并为用户画像，避免无意扩大隐私范围。
