# 本地资料助手 · Local Reader MCP

让 ChatGPT 按需搜索和读取你主动授权的本地项目与资料。Mac 原生管理窗口、菜单栏常驻、只读 MCP 和 OpenAI Secure MCP Tunnel 集成。

**[下载安装包](https://github.com/dudu555-djiao/local-reader-mcp/releases) · [完整配置教程](docs/QUICKSTART.zh-CN.md) · [常见问题](docs/TROUBLESHOOTING.zh-CN.md) · [隐私说明](PRIVACY.md)**

> 当前发布为 **0.1.0-beta.1，macOS 14+ / Apple Silicon（M 系列）测试版**。未经过 Apple Developer ID 签名或公证。Windows、Intel Mac 尚无安装包。ChatGPT 网页连接要求你的账号具有自定义 MCP 和 Tunnel 访问权限，购买订阅不保证获得这些入口。没有相应权限时可使用本地预览、导出 Markdown，或接入支持 stdio 的本地 MCP 客户端。

## 快速开始

1. 从 **Releases** 下载 `LocalReader-0.1.0-beta.1-macos-arm64.zip`，解压后把“本地资料助手.app”拖入“应用程序”。解压目录有离线中文教程；Release 另提供 SHA256 校验文件。
2. 打开软件，点击 **添加文件夹**。首次安装没有任何预授权目录，选择你愿意提供给模型的资料。
3. 点击 **连接 ChatGPT**，按向导创建自己的 Tunnel、生成只含 Tunnels Read + Use 权限的运行 API key，填入本机配置窗口。需要代理时填入自己的 HTTP 代理地址。
4. 点击 **启动连接**。再去 ChatGPT 插件页面创建自定义 MCP，连接方式选 **Tunnel / 隧道**，身份验证明确选择 **No authentication / 无需身份验证**。
5. 安装并在聊天中选择插件，发送下面的验证提示词。

```text
请使用本地资料助手，先调用 server_info 检查服务，再调用 list_folders。
只列出已授权文件夹，不读取正文。确认后我会指定需要分析的项目。
```

首次配置不需要写代码。[逐步教程](docs/QUICKSTART.zh-CN.md)解释 Tunnel ID、运行密钥、代理和网页插件每个字段。软件不会替你创建账户凭据，也不会调用模型推理 API；Tunnel 服务是否可用及费用以 OpenAI 当时政策为准。

## 使用场景

- 让 ChatGPT 搜索真实源码、解释架构、分析日志并引用相对路径和行号。
- 同时管理多个项目，以后添加文件夹无需重建 MCP。
- 使用 Chat 中可用的模型形成方案，再将方案交给本地 Codex 核对和实施。
- 连接不可用时，手动导出经过过滤、有范围说明的 Markdown 文本快照。

整个项目不会一次性上传。模型通过工具按问题读取；**被读取的内容会发送给 OpenAI，文件原件仍在你的电脑上**。只读限制不等于内容不会外传。

## 结构

```text
ChatGPT → 每位用户自己的 OpenAI Tunnel
        → 该用户电脑上的 Tunnel 客户端
        → 仅监听 127.0.0.1 的 MCP 服务
        → 本地手动授权的文件夹
```

共享的是软件，不是连接信息。不要把某个用户的 Tunnel、API key、文件夹设置或已注册插件技术 ID 写入公共配置。

OpenAI Secure MCP Tunnel 用于私有连接，目前不能直接用于公开插件商店上架。因此本项目采用“下载本地软件 + 在自己账户创建个人 MCP 插件”的方式，而不是要求所有人连接同一个公开服务器。[官方 Tunnel 说明](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)

## 能力和限制

| 工具 | 用途 |
| --- | --- |
| server_info | 服务状态和读取范围说明 |
| list_folders | 列出已启用的授权文件夹 |
| list_directory | 分页查看相对目录 |
| search_files / search_content | 按字面搜索文件名或源码文本 |
| read_file | 分页读取文本、可选文本 PDF、DOCX / RTF |
| git_summary | 本地独立 Git 仓库状态、提交与差异统计 |
| database_schema / database_rows | SQLite 普通表结构与过滤后的分页样例 |

不提供文件修改、删除、任意命令或任意 SQL 工具。文档提取依赖 macOS PDFKit / textutil。图片、音视频、扫描 PDF 的 OCR、Excel、MySQL / PostgreSQL 暂不支持。大型文件和目录有返回上限，不保证每个文件都被完整阅读，具体见 [开发说明](docs/DEVELOPMENT.md)。

凭据文件、常见依赖与构建目录被排除，常见密钥和个人标识做尽力脱敏。**这不是完整匿名化**；请先选择适合发送给模型的资料范围。[隐私与数据边界](PRIVACY.md)

## 后台运行

关闭红色窗口按钮只隐藏窗口，菜单栏仍运行；菜单中的“退出”或 ⌘Q 会停止 MCP 与通道。电脑休眠、断网时无法继续读取。重启后需手动打开软件并启动连接；本版没有开机自动启动。

## 开发者

```sh
npm ci
npm test
python3 scripts/check-public-files.py
```

构建 Mac 应用需要 Apple Silicon Mac、Xcode Command Line Tools、Python 3 和联网下载官方运行环境：

```sh
python3 scripts/download-runtime.py
PATH="$PWD/.cache/runtime:$PATH" npm ci
bash scripts/build-macos.sh
```

可复现的下载版本、SHA256 校验、构建方法与 stdio 接入见 [开发说明](docs/DEVELOPMENT.md)。安装包在 Releases；Git 仓库只保存源码、文档和合成测试数据。

## 开源与反馈

项目源码采用 [MIT](LICENSE)。Node、Tunnel 客户端、cloudflared 及 npm 依赖保持各自许可证，详见 [第三方声明](THIRD_PARTY_NOTICES.md)。这是独立社区项目，不代表 OpenAI。

提交问题前请阅读 [反馈规范](CONTRIBUTING.md)，不要附带密钥、个人文件路径、数据库、访问记录或未经处理的截图。安全问题按 [报告说明](SECURITY.md)反馈。
