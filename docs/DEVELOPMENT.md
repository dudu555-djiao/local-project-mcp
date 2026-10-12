# 开发与构建

## 目录

- src/：MCP、读取与本地管理 HTTP 服务。
- native/：Swift / Cocoa / WebKit 原生界面桥接、PDFKit 提取、Tunnel 进程管理。
- ui/：本地网页管理界面。
- tests/：合成资料、SQLite 与 MCP SDK 集成测试。
- scripts/：下载、构建、打包和公开文件检查。
- docs/：中文安装、配置和排错。

本版主要面向 macOS 14+ / Apple Silicon。源码 CLI 核心使用 Node 24+，PDF / DOCX / RTF 提取依赖 Mac，其他平台未完成验证。

## 构建

需要 Apple Silicon Mac、Xcode Command Line Tools（swiftc）、Python 3、curl 和 npm。脚本固定 Node 24.16.0 / Tunnel 0.0.15，核对官方 SHA256 清单后解压到 .cache/runtime。网络代理可通过当前终端 HTTPS_PROXY 配置；不要提交代理中的凭据。

```sh
python3 scripts/download-runtime.py
export PATH="$PWD/.cache/runtime:$PATH"
npm ci
npm test
bash scripts/test-native.sh
bash scripts/build-macos.sh
bash scripts/package-release.sh
```

build/、dist/、.cache/ 和 node_modules/ 不进入 Git。安装包只复制源码、UI、必要依赖、运行文件与许可证，不读取 Application Support 或钥匙串。Swift 源文件路径通过 prefix map 替换，避免二进制包含开发电脑路径。

## stdio 接入

本地客户端需要 Node 24+、本项目依赖，以及用户已在 GUI 中授权的文件夹。本地 stdio 不需要 Tunnel key。

```sh
node src/server.js --stdio
```

将客户端 command 配为自己的 Node 可执行文件，args 配为本项目 src/server.js 的绝对路径和 --stdio；不要照抄别人的磁盘路径。默认共享社区版 LocalReaderMCP 数据目录，授权管理仍由本地 app 完成。

如需隔离测试，可显式设置 LOCALREADER_DATA_DIR。HTTP 方式由原生应用自动启动并使用随机独立令牌，不能把管理页面 URL 交给 ChatGPT；网页端使用 Tunnel。

## 读取上限

- 文本 2 MiB，文档 20 MiB；PDF 最多 100 页，无 OCR。
- 默认每次 200 行，最多 500 行；单次返回约 48,000 字符。
- 扫描最多 5,000 项，有时间预算；导出最多 150 个文本文件、约 100 万字符，文档与数据库不直接进入导出正文。
- SQLite 只读、query_only、普通表，最多 50 行，不接受调用者 SQL；Git 不调用用户配置的外部 diff / hooks / fsmonitor，不支持外部 .git 工作树。
- MCP 最多 4 个并发请求；管理接口同源且使用独立令牌。
- 返回分页、过滤和截断标记，模型应据此说明未读范围。

## 发布

初版是没有 Developer ID 公证的测试包。维护者若以后提供开发者证书，应在自己的安全构建环境完成签名、公证和校验，证书及密码不进入仓库。当前打包脚本只做本机临时签名并保留第三方许可证。

公开发布前检查 `git ls-files`，运行公开文件扫描，再人工复核 README、Release 文案、作者邮箱、二进制和 ZIP 清单。通用扫描无法识别所有业务隐私；测试仅使用合成资料。
