# 本地项目助手 · Local Project MCP

让 ChatGPT 按需搜索和读取你主动授权的本地项目与资料，并在你为具体文件夹开启编辑后直接修改文本文件。Mac 原生管理窗口、菜单栏常驻、MCP 和 OpenAI Secure MCP Tunnel 集成。

**[下载安装包](https://github.com/dudu555-djiao/local-project-mcp/releases) · [完整配置教程](docs/QUICKSTART.zh-CN.md) · [常见问题](docs/TROUBLESHOOTING.zh-CN.md) · [隐私说明](PRIVACY.md)**

> Mac 安装包为 **0.2.0-beta.1，macOS 14+ / Apple Silicon（M 系列）**；新增 **0.2.0-beta.2 Windows 10 / 11 x64** 客户端与安装包构建流程。安装包见 Releases，验证范围见[验证记录](docs/VERIFICATION.md)。Mac 版未经过 Apple Developer ID 签名或公证，Windows 版未购买代码签名证书；Intel Mac 和 Windows ARM64 原生安装包尚未提供。ChatGPT 网页连接要求账号具有自定义 MCP 和 Tunnel 权限，购买订阅不保证获得这些入口。

Windows 用户请按 [Windows 中文安装教程](docs/QUICKSTART.windows.zh-CN.md) 下载 `LocalProject-0.2.0-beta.2-windows-x64-setup.exe`；下方拖入“应用程序”的操作适用于 Mac。

## 快速开始

1. 从 **Releases** 下载 `LocalReader-0.2.0-beta.1-macos-arm64.zip`，解压后把“本地资料助手.app”拖入“应用程序”。解压目录有离线中文教程；Release 另提供 SHA256 校验文件。
2. 打开软件，点击 **添加文件夹**。首次安装没有任何预授权目录；新加文件夹及从旧版升级的文件夹默认只读，编辑需要逐个开启。
3. 点击 **连接 ChatGPT**，按向导创建自己的 Tunnel、生成只含 Tunnels Read + Use 权限的运行 API key，填入本机配置窗口。需要代理时填入自己的 HTTP 代理地址。
4. 点击 **启动连接**。再去 ChatGPT 插件页面创建自定义 MCP，连接方式选 **Tunnel / 隧道**，身份验证明确选择 **No authentication / 无需身份验证**。
5. 安装并在聊天中选择插件，发送下面的验证提示词。

```text
请使用本地项目助手，先调用 server_info 检查服务，再调用 list_folders。
只列出已授权文件夹，不读取正文。确认后我会指定需要分析的项目。
```

安装后只使用“应用程序”里的 app。下载目录中解压出的同名副本可移到废纸篓，避免系统搜索出现多个入口；不要清理保存设置和修改备份的 Application Support 目录。

beta.2 新增 Windows 客户端，现有 Mac beta.1 安装包保留，Mac 用户无需重新安装。Mac 更名保留原数据目录、应用标识和钥匙串服务名；已有授权、设置、备份和密钥可继续使用。Windows 使用独立的本机数据目录与当前用户加密存储，不导入他人的配置。ChatGPT 中的个人插件名称可在个人插件设置中手动修改并刷新工具列表。

首次配置不需要写代码。[逐步教程](docs/QUICKSTART.zh-CN.md)解释 Tunnel ID、运行密钥、代理和网页插件每个字段。软件不会替你创建账户凭据，也不会调用模型推理 API；Tunnel 服务是否可用及费用以 OpenAI 当时政策为准。

读取验证成功后，在本地为测试文件夹开启 **允许编辑**，让 ChatGPT 先调用 `prepare_edit` 返回修改预览，再调用 `apply_edit` 应用提案。升级后需要在 ChatGPT 刷新插件工具列表；旧聊天未显示新工具时新建聊天。完整步骤及恢复方法见[编辑教程](docs/QUICKSTART.zh-CN.md#8-开启编辑并完成第一次修改)。

0.2.0-beta.1 已用合成 UTF-8 文件完成网页读取、预览、保存、读回及本机恢复验收；本次 beta.2 更名的验证状态单独记录，范围和限制见[验证记录](docs/VERIFICATION.md)。

## 使用场景

- 让 ChatGPT 搜索真实源码、解释架构、分析日志并引用相对路径和行号。
- 同时管理多个项目，以后添加文件夹无需重建 MCP。
- 在已开启编辑的项目内，让网页 ChatGPT 生成具体修改、预览后调用本机工具保存代码，不需要 Codex 再解释一遍方案。
- 也可以继续只读分析，再将方案交给本地 Codex 核对、测试和实施。
- 连接不可用时，手动导出经过过滤、有范围说明的 Markdown 文本快照。

整个项目不会一次性上传。模型通过工具按问题读取；**工具返回的内容会发送给 OpenAI，原文件保存在你的电脑上，确认应用编辑后原文件会被修改**。只读限制不等于内容不会外传。

## 结构

```text
ChatGPT → 每位用户自己的 OpenAI Tunnel
        → 该用户电脑上的 Tunnel 客户端
        → 仅监听 127.0.0.1 的 MCP 服务
        → 本地手动授权的文件夹（默认只读，逐个选择允许编辑）
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
| prepare_edit | 为新建文本文件或精确文本替换生成差异预览与 10 分钟有效的 proposalId |
| apply_edit | 校验权限、路径和文件版本后，应用指定提案并返回结果 |
| list_changes | 查看本软件记录的编辑和恢复记录 |
| prepare_restore | 从某次修改的本地备份生成恢复预览，再由 apply_edit 应用 |

编辑限于最多 2 MiB 的 UTF-8 源码和文本文件；单次请求文本总量最多 50 万字符，局部替换最多 20 处。新建文件可创建必要子目录；不提供整文件覆盖、删除、移动、任意命令或任意 SQL。PDF、DOCX、数据库、凭据文件、符号链接和硬链接不能编辑。替换必须使用最近一次 `read_file` 返回的 `version`（SHA256）；提案过期、服务重启、权限变化或检测到原文件变化时，应用会拒绝写入，必须重新预览。请避免多个编辑器或 Agent 同时保存同一个文件，文件检查不替代操作系统沙箱或跨程序的协同编辑。

ChatGPT 中写入工具默认需要确认；具体提示以客户端设置为准。**开启文件夹编辑是持续授权，不是每次修改都弹出本地审批窗口。**软件在本机执行文件操作，不调用 Codex，也不会自行运行测试、安装依赖、提交 Git 或部署。

文档提取依赖 macOS PDFKit / textutil。图片、音视频、扫描 PDF 的 OCR、Excel、MySQL / PostgreSQL 暂不支持。大型文件和目录有返回上限，不保证每个文件都被完整阅读，具体见 [开发说明](docs/DEVELOPMENT.md)。

凭据文件、常见依赖与构建目录被排除，常见密钥和个人标识做尽力脱敏。**这不是完整匿名化**；请先选择适合发送给模型的资料范围。[隐私与数据边界](PRIVACY.md)

读取结果可能包含脱敏占位文字。请让模型使用原文可见部分做精确局部替换，不能把读取结果当作原文件全文覆盖回去；匹配到被隐藏区域或将脱敏占位文字写回文件的编辑会被拒绝。备份保存在本机私有 Application Support 目录中，不放进项目或公开发行包；备份累计上限 200 MiB，满时拒绝新的写入，不自动清理。内容恢复只适用于修改前已有的文件；新建文件不自动删除撤销。

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
