# Changelog

本项目的显著变化记录在此文件。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [0.2.0] - 2026-08-21

### Added

- 新增 Codex Harness 在线初始化与协议兼容检查 `npm run codex:check`。
- 新增 Codex app-server 客户端回归测试，覆盖工具审批与未知权限请求的安全拒绝。
- 新增 GitHub Actions 持续集成，执行检查、构建和 Harness 协议验证。

### Changed

- 将官方 `@openai/codex` 从 0.145.0 升级并固定到 0.149.0。
- 使用根目录 `.codex-version` 统一 Docker 构建、协议生成和维护文档中的 Harness 版本。
- 将平台包版本升级为 0.2.0，并让 app-server 客户端上报实际平台版本。
- 更新 README、架构和部署文档，明确 CLI、Harness、宿主机与容器的关系。

### Security

- 对尚未实现的 app-server 服务端请求返回 JSON-RPC `-32601`，避免使用不匹配的通用批准响应。

## [0.1.0] - 2026-08-16

- 首个公开开发版本：多租户组织、Markdown Wiki、Codex 对话、Skill、周期任务、Crawl4AI、用量与审计。

[Unreleased]: https://github.com/YixiaoOneSmile/codex-wiki-platform/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/YixiaoOneSmile/codex-wiki-platform/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/YixiaoOneSmile/codex-wiki-platform/releases/tag/v0.1.0
