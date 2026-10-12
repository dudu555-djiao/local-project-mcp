# 贡献与反馈

源码采用 MIT。提交 PR 即表示你有权以该许可证提供贡献。

## 本地检查

使用 Node 24+ 运行 `npm ci && npm test`。Mac 原生部分按 `docs/DEVELOPMENT.md` 构建；运行 `bash scripts/test-native.sh` 检查连接状态判断。提交前运行 `python3 scripts/check-public-files.py`。

## 报告问题

说明版本、系统与芯片、最小复现步骤、预期行为及实际结果。仅用合成测试资料。请去除密钥、Token、Tunnel/组织/工作空间 ID、个人路径、姓名、联系方式、业务库和聊天记录。不要上传 Application Support 目录、整份诊断包或你正在使用的 app 数据。

不要加入开发者电脑的绝对路径、带凭据的 MCP 配置、运行日志或下载的二进制。安装包通过构建脚本生成并放到 Releases。
