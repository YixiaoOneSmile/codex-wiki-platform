# 安全基线

- DeepSeek/API 密钥仅从服务端环境读取，日志脱敏器拦截授权头、密钥字段和常见 token 模式。
- 登录会话使用 HttpOnly、SameSite=Lax cookie；生产环境必须启用 Secure。
- 每次请求生成 correlation ID；审计记录操作者、组织、动作、对象和结果，不保存密码或完整提示词。
- 租户文件路径由服务端 UUID 构造，禁止使用用户输入直接拼接绝对路径或 `..`。
- 默认 `AGENT_SHELL_ENABLED=false`：知识查询和组织 Skill 由服务端按租户权限直接提供完整内容，
  Agent 不执行 shell。只有部署者已经提供并验证独立的运行级沙箱后，才可显式开启 shell；
  高风险操作仍需用户逐次批准。
- Wiki 权限在界面、API 和 Agent 工具三层执行。界面隐藏不是授权手段。
- 生产部署前必须完成跨租户 API、Codex thread ID、Wiki 上下文和 Skill 隔离测试。

## 人工关口

未经项目所有者明确批准，不执行公网部署、生产数据导入、不可逆迁移/删除、付费资源购买、
仓库公开、真实密钥提交或采用 AGPL/SSPL/商业限制核心依赖。
