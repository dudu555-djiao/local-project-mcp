# 从下载安装到第一次成功读取

本教程适用于 macOS 14 或更新版本、Apple Silicon（M 系列芯片）。点击 Mac 左上角“关于本机”可查看系统与芯片。

## 1. 下载并打开

- 在 GitHub 仓库的 **Releases** 下载 `LocalReader-0.1.0-beta.1-macos-arm64.zip`；不要选“Source code”，那是开发者源码。
- 解压，把“本地资料助手.app”拖进“应用程序”，然后打开。无需另装 Node、MCP SDK 或 Tunnel 客户端。
- 本版没有 Apple Developer ID 签名和公证。macOS 可能阻止首次打开；确认从本项目 Releases 下载并核对 SHA256 后，按“系统设置 → 隐私与安全性”的系统提示允许打开。如果系统或单位策略不允许，停止安装并使用源码方案，不要关闭系统安全保护。
- 校验下载文件：在下载目录运行 `shasum -a 256 LocalReader-0.1.0-beta.1-macos-arm64.zip`，比对该 Release 的 `SHA256SUMS.txt`。

## 2. 选择资料文件夹

在“资料文件夹”页点击 **添加文件夹**，选择具体项目或资料目录。不要选择整个磁盘或整个用户主目录。

添加后使用 **预览**看允许读取的第一层目录。可以添加多个目录，单独停用或移除，也可以 **暂停全部读取**。移除只撤回授权，不删除文件。

建议第一次只添加一个不含隐私的测试目录，放一个自己写的 README.md，用它完成下面的连接验证。

## 3. 创建自己的 OpenAI Tunnel

打开 [OpenAI Tunnel 设置](https://platform.openai.com/settings/organization/tunnels)。该入口是否可用取决于账号、组织和工作空间权限，未开放时无法靠本软件绕过。

1. 点击 **Create tunnel**。
2. Name 填“本地资料助手”；Description 填“读取本人主动授权的本地资料”。
3. Organizations 选择自己的 Platform 组织；ChatGPT workspaces 选择你真正使用的 ChatGPT 工作空间。
4. 创建后复制 `tunnel_` 开头的 ID，待会填入软件。

创建或编辑 Tunnel 需要 Tunnels **Read + Manage**；运行和选择 Tunnel 需要 **Read + Use**。组织权限与 ChatGPT 工作空间权限分别检查。不要使用作者、同事或他人的 Tunnel。

## 4. 创建运行密钥

打开 [OpenAI 运行 API keys](https://platform.openai.com/settings/organization/api-keys)，创建供本软件使用的独立密钥。

- 名称可填“Local Reader”。如需选择 Project，选择自己的 Platform 项目，这不是上传本地代码。
- Permissions 选择 **Restricted**，只开启 **Tunnels Read + Use**。其他能力保持 None；具体选项名称以平台当前界面为准。
- 如果没有这些选项，先核对组织与账号权限，不要为方便直接使用 Admin key 或打开全部权限。
- 密钥由平台生成，不是自己编的登录密码。复制后直接粘贴进本机软件，不发给别人、不贴到聊天、GitHub 或截图里。

这个 key 用于官方 Tunnel 客户端认证。本软件不调用模型推理 API；它不把 ChatGPT 订阅转换成 API 余额，不承诺 Tunnel 或账户服务免费。

## 5. 在软件中配置并启动

打开 **连接 ChatGPT → 配置连接**：

| 字段 | 填写方式 |
| --- | --- |
| Tunnel ID | 上一步创建的 tunnel_ 开头 ID |
| 运行密钥 | 平台生成的 sk- 开头密钥 |
| 保存在 Mac 钥匙串 | 可选；勾选后下次可复用，否则退出软件后需要重新输入 |
| 组织 ID | 可选；有多个组织且需要明确指定时填自己的组织 ID |
| HTTPS 代理地址 | 需要代理时填自己的 HTTP 代理 URL，例如 http://127.0.0.1:7897；端口必须与自己的代理软件一致 |

保存后点击 **启动连接**。浏览器能上网不代表 Tunnel 会自动使用系统代理；本版需要手动填写代理。

“已连接”表示本地客户端就绪且最近 90 秒内有一次成功的 OpenAI 轮询。它不代表网页插件已经创建，也不代表模型已经读取成功。

## 6. 在 ChatGPT 创建个人插件

保持电脑、代理（如有）和本软件运行，打开 [ChatGPT 插件](https://chatgpt.com/plugins)。

1. 点击“添加”→“创建自定义 MCP 服务器”。
2. 名称填“本地资料助手”。描述可填“搜索和读取我主动授权的本地文件夹”。
3. 连接选择 **Tunnel / 隧道**，选择或粘贴自己的 Tunnel ID。
4. 身份验证明确选择 **No authentication / 无需身份验证**。不要选 OAuth，也不要选“OAuth 或无需身份验证”。本地访问令牌由客户端携带，账号访问范围由 Tunnel 控制。
5. 阅读风险提示，确认后创建并安装插件。

如果看不到自定义 MCP 或 Tunnel 入口，检查当前工作空间及账号支持范围。软件无法替账号开通该能力。

## 7. 验证读取

在新的 Chat 聊天中通过 @ 或工具选择器选中“本地资料助手”。使用你账号可用的模型；如果希望使用 Pro，请选择 Chat 中可用的 Pro 模型。

先发送：

```text
请使用本地资料助手，调用 server_info 和 list_folders。
列出工具真实返回的状态和已授权文件夹，不要猜测本机内容。
```

然后指定刚才的测试文件夹：

```text
请查看这个测试文件夹的第一层目录，读取 README.md。
引用相对路径和行号，说明是否完整读取以及有没有过滤或截断。
```

软件“访问记录”里出现对应工具调用，模型返回与测试文件一致的内容，才算完成实际读取验证。没有真实工具结果时不要把聊天中的口头确认当成成功。

## 8. 日常使用和交给 Codex

之后直接添加新的资料文件夹，按问题让模型搜索并分批读取。

桌面客户端支持相关入口时，可从 Codex 的“新聊天”打开 Quick Chat，选择已有的 ChatGPT 对话，再“添加到 Codex”。如果入口无反应，先保存草稿，退出并重新打开桌面客户端；仍不可用时复制最终方案到正确的 Codex 本地项目。不要依赖共享链接一定能被 Codex 读取。

让 Codex 先核对当前代码、方案假设和测试方法，再按你的明确要求实施。本软件只读，不负责自动修改或上线。

## 9. 关闭和升级

- 红色关闭按钮隐藏窗口，菜单栏继续运行；⌘Q 或菜单“退出”会停止服务。
- 休眠、断网、关机期间无法读取。重新联网时 Tunnel 客户端会重试；重新打开软件后仍需点击“启动连接”。
- 升级前退出旧版，用新版替换“应用程序”中的 app。用户设置保存在自己的 Application Support 目录，不放在 app 包内。
- 本社区发行版使用 `~/Library/Application Support/LocalReaderMCP/`，首次安装为空白配置，需要由用户主动授权。

官方参考：[Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)、[自定义 MCP](https://developers.openai.com/api/docs/guides/custom-mcp-server)、[Quick Chat](https://learn.chatgpt.com/docs/projects#use-quick-chat-for-a-quick-question)。
