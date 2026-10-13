# Windows 安装与配置

Windows 客户端复用 Mac 版管理界面和 MCP 工具。首版提供 Windows 10 / 11 x64 安装包；ARM64 原生安装包尚未提供。发布状态和验证范围见 [验证记录](VERIFICATION.md)。

## 1. 下载与安装

在本仓库 Releases 的 Assets 下载 `LocalProject-0.2.0-beta.2-windows-x64-setup.exe`，不要下载 Mac ZIP 或 Source code。下载同一 Release 的 `SHA256SUMS-windows.txt`，在 PowerShell 中运行：

```powershell
Get-FileHash .\LocalProject-0.2.0-beta.2-windows-x64-setup.exe -Algorithm SHA256
```

比对校验文件。运行安装向导，为当前 Windows 用户安装。安装包包含 Electron 界面、Node、官方 Tunnel 客户端、cloudflared、MinGit 和文档解析依赖，无需另装 Node、Git、Office 或开发环境。首次安装没有资料授权、Tunnel 或运行密钥。

测试版未购买 Windows 代码签名证书，可能被 SmartScreen 或单位策略拦截。先核对项目 Releases 来源及 SHA256，按系统和单位政策处理；不要关闭 Defender、SmartScreen 或其他系统安全保护。

## 2. 添加测试文件夹

打开“本地项目助手”，点击“添加文件夹”，选择一个不含隐私的本地资料目录。新加文件夹默认只读。不要选择整块磁盘、整个用户目录、网络共享、应用自己的数据目录或凭据目录。Windows 路径中的符号链接和 junction 不作为读取入口。

点击“预览”查看第一层目录。移除只撤回授权，不删除原文件。

## 3. 配置 Tunnel 与运行密钥

账号和网页配置与 Mac 版相同，具体入口见 [中文配置教程](QUICKSTART.zh-CN.md#3-创建自己的-openai-tunnel)。

1. 在 OpenAI Tunnel 设置中创建自己的 Tunnel，关联 Platform 组织和真正使用的 ChatGPT 工作空间。创建需要 Tunnels Read + Manage。
2. 创建独立运行 API key，Restricted 下只开启 Tunnels Read + Use。不要使用 Admin key 或扩大模型权限。
3. 在软件“连接 ChatGPT → 配置连接”填入 Tunnel ID 和运行密钥。密钥只在本机填写，不发到聊天、GitHub 或截图里。
4. “使用 Windows 当前用户加密保存运行密钥”为可选项。勾选后通过 Windows DPAPI 加密，只能由原 Windows 用户解密。取消勾选后仅在本次运行中保留密钥，退出后需重填。
5. 组织 ID 可选。需要代理时填写自己代理软件的 HTTP URL，如 `http://127.0.0.1:7897`；端口以自己的 HTTP / 混合端口为准。浏览器能联网不代表 Tunnel 自动使用系统代理。
6. 保存并点击“启动连接”。“通道已连通”要求最近 90 秒内有成功的 OpenAI 轮询，不只表示本地服务已启动。

## 4. 创建 ChatGPT 个人插件

保持软件及代理运行。打开 ChatGPT 插件页面，添加自定义 MCP 服务器，名称填“本地项目助手”，连接方式选 Tunnel，选择自己的 Tunnel ID，认证明确选 No authentication / 无需身份验证。

创建并安装后，在新聊天中通过 @ 选择插件。看不到入口时检查账号、组织和工作空间权限，软件不能替账号开通。

## 5. 真实读取与编辑验证

先请求 `server_info` 和 `list_folders`，再让模型读取测试目录的 README.md。检查真实工具返回、相对路径、行号、截断信息及本机“访问记录”。只有通道状态变绿不算端到端验证成功。

需要编辑时，在本机为测试目录点击“允许编辑”，核对 Windows 确认窗口中的项目和路径。使用最近 `read_file` 返回的 version 调用 `prepare_edit`，审阅预览后再调用 `apply_edit`，最后读回并核对磁盘文件。

“修改历史”可恢复修改前已有文件的旧内容；有版本冲突时拒绝覆盖，新建文件不会自动删除。编辑权限是持续授权，可随时关闭。默认只读、暂停、过滤、预览、10 分钟提案、2 MiB 编辑上限和 200 MiB 备份上限与 Mac 版相同。

## 6. 功能与平台差异

支持源码/文本搜索读取、可选文本 PDF（最多 100 页，无 OCR）、DOCX / RTF 正文提取、SQLite 结构与分页样例、独立 Git 仓库摘要、Markdown 导出，以及 UTF-8 文本的预览编辑和备份恢复。

Windows 文档提取使用 PDF.js、DOCX XML 及 RTF 解析器，Mac 版继续使用 PDFKit / textutil。复杂布局、样式、图像、RTF 表格等不保证完整保留；同一文档在两个平台的换行和文字提取顺序可能不同。文档解析限 12 秒和独立 worker 资源预算。

Windows 数据位于 `%LOCALAPPDATA%\LocalReaderMCP\`，包含文件夹授权、访问记录、连接设置、加密密钥和编辑备份。软件限制该目录 ACL 为当前用户与 SYSTEM；同一 Windows 用户下的其他程序仍处于同一信任边界。不要上传整个数据目录。卸载保留数据和备份，删除前确认恢复需求。

关闭窗口隐藏到系统托盘，连接继续运行；托盘“退出”停止服务和 Tunnel。首版不自动开机启动，也不自动启动连接。休眠、断网期间无法读取。
