新增 Windows 10 / 11 x64 桌面客户端。原有 Mac beta.1 安装包保留，Mac 用户无需重新安装。

## 下载

- `LocalProject-0.2.0-beta.2-windows-x64-setup.exe`：Windows 安装包。
- `SHA256SUMS-windows.txt`：安装包 SHA256 校验值。
- `QUICKSTART.windows.zh-CN.md`：Windows 中文安装配置教程。

安装包附带 Node、官方 Tunnel 客户端、cloudflared、MinGit 和文档解析依赖，无需另装开发环境、Git 或 Office。首次安装没有预授权目录、个人 Tunnel 或密钥。

## 保留的主要功能

文件夹授权与默认只读、搜索和读取、PDF / DOCX / RTF 正文提取、SQLite 样例、Git 摘要、13 个 MCP 工具、文本编辑预览与应用、本地备份恢复、访问记录、Markdown 导出、托盘常驻、Tunnel 配置与诊断。Windows 密钥可通过当前用户 DPAPI 加密保存。

## 验证与限制

Windows Server 2022 x64 GitHub runner 的 35 项测试和安装后的桌面验收通过，覆盖真实文件读写与恢复、文档提取、内置运行组件、导出、授权撤销与加密保存。本次没有使用真实 OpenAI key，也没有进行 Windows 用户账号经 Tunnel 到 ChatGPT 网页模型的新一次端到端验收；用户仍需按教程完成自己的实际读取验证。

这是未购买代码签名证书的测试版；核对来源和 SHA256，遵守系统及单位策略，不要关闭系统安全保护。Windows ARM64 原生安装包尚未提供。复杂文档的布局、表格和提取顺序不保证与 Mac 完全一致；无 OCR，不提供任意终端、SQL 写入、删除或部署工具。

完整验证范围见仓库 `docs/VERIFICATION.md`。
