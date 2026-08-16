# 许可证与代码来源

本项目原创代码采用 Apache License 2.0，完整条款位于根目录 `LICENSE`。

- Codex 通过官方 Apache-2.0 发行包安装和进程协议调用，不复制其实现代码。
- 未复制 Simple Agent Manager、AionUI 或其他受 AGPL/GPL 限制项目的代码、样式资源或数据库结构。
- 生产依赖必须通过 `npm run licenses:check`；该检查只允许宽松许可证，遇到缺失、AGPL、GPL-only、SSPL、BUSL、Commons Clause 或未知许可证会失败。
- 带 `OR` 的依赖按其宽松许可证选项使用；例如 JSZip 选择 MIT 许可。
- 开发依赖不会随生产镜像发布，但升级前仍应结合锁文件、上游 NOTICE 和实际分发方式复核。
