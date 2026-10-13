# 开发与构建

## 目录

- src/：MCP、读取、编辑提案与恢复、本地管理 HTTP 服务。
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

将客户端 command 配为自己的 Node 可执行文件，args 配为本项目 src/server.js 的绝对路径和 --stdio；不要照抄别人的磁盘路径。默认共享社区版 LocalReaderMCP 数据目录，读取和编辑授权管理仍由本地 app 完成。

如需隔离测试，可显式设置 LOCALREADER_DATA_DIR。HTTP 方式由原生应用自动启动并使用随机独立令牌，不能把管理页面 URL 交给 ChatGPT；网页端使用 Tunnel。

## 读取上限

- 文本 2 MiB，文档 20 MiB；PDF 最多 100 页，无 OCR。
- 默认每次 200 行，最多 500 行；单次返回约 48,000 字符。
- 扫描最多 5,000 项，有时间预算；导出最多 150 个文本文件、约 100 万字符，文档与数据库不直接进入导出正文。
- SQLite 只读、query_only、普通表，最多 50 行，不接受调用者 SQL；Git 不调用用户配置的外部 diff / hooks / fsmonitor，不支持外部 .git 工作树。
- MCP 最多 4 个并发请求；管理接口同源且使用独立令牌。
- 返回分页、过滤和截断标记，模型应据此说明未读范围。

## 编辑接口与授权

文件夹授权增加 `editable` 开关，缺省为 `false`。迁移只读版设置时，不为已有文件夹自动开启编辑；只有本机管理界面可以改变授权，MCP 没有新增目录或启用编辑的工具。保存的权限在重启后保留，提案绑定当前服务实例，不跨重启复用。

编辑流程分两步：

1. 模型读取文件，取得 `read_file` 返回的 `version`（原文件 SHA256）。调用 `prepare_edit` 选择新建或精确文本替换，得到预览和 `proposalId`；此时不修改项目文件。
2. 模型调用 `apply_edit`。本机重新校验文件夹编辑授权、启用/暂停状态、路径、原文件 SHA256 和 stat 文件属性，通过后写入并保存编辑记录。写入工具的 MCP 注解 `readOnlyHint` 为 `false`，不能把写操作伪装成读取。

提案 10 分钟有效。关闭编辑、停用文件夹或全局暂停会使旧提案失效，重新开启不会恢复旧提案。版本不一致时应重新读取并生成预览，没有忽略冲突、强制应用或整文件覆盖接口。网页端是否显示及如何显示确认由 ChatGPT 客户端控制；本机文件夹授权是独立检查。

读取及写入前的 SHA256 / stat 检查在检测到变化时拒绝保存，不是针对外部进程任意瞬间写入的绝对 compare-and-swap 保证。应避免多个编辑器或 Agent 同时保存同一文件；路径限制及版本检查也不是操作系统沙箱。

编辑限 UTF-8 源码/文本，文件最多 2 MiB，单次请求文本总量最多 50 万字符，替换最多 20 处。新建可创建必要子目录，但不能覆盖已存在的文件。PDF、DOCX、数据库、凭据文件、符号链接和硬链接不可编辑；没有删除、移动、任意命令、任意 SQL、自动测试、Git 提交或部署工具。

读取输出经过脱敏，不能把输出作为原文整文件覆盖。替换只针对可见的精确原文；涉及脱敏区域的旧文本以及将脱敏占位文字写入文件的请求会被拒绝，未修改部分保留本机原文。

## 修改记录与恢复

修改前已有文件的原内容保存在私有 Application Support 数据目录，不写进用户项目。`list_changes` 提供修改记录；`prepare_restore` 从可恢复记录生成预览，再由 `apply_edit` 应用。恢复也校验当前文件版本，检测到后续变化时拒绝写入。新建文件记录 `canRestore: false`，不提供通过恢复执行删除的能力。

项目写入成功之后，完成记录、提案回执或审计日志仍可能遇到 ENOSPC 等故障。此时返回 `applied: true` 与 `warning`；不能把警告理解为项目未写入。历史加载会依据当前 SHA256 与备份校验恢复能够确认的记录；无法确认的条目为 `needsReview`，禁用恢复并要求人工核对。调用者应核对真实文件、`verified`、警告及修改历史，避免因重试生成重复改动。

备份不自动清理，累计上限 200 MiB，满时拒绝新的写入。私有备份可能包含敏感原文，不能纳入 Git、构建输入、Release 或错误反馈附件。归档或删除备份会影响恢复能力。

本机资料助手负责确定性的路径检查、替换、备份和保存；代码修改内容来自网页模型。无需本机 Codex 二次推理，也不调用模型推理 API。开发者应验证真实工具调用后的磁盘内容，不把模型口头报告或预览生成当作写入成功。

## 发布

初版是没有 Developer ID 公证的测试包。维护者若以后提供开发者证书，应在自己的安全构建环境完成签名、公证和校验，证书及密码不进入仓库。当前打包脚本只做本机临时签名并保留第三方许可证。

公开发布前检查 `git ls-files`，运行公开文件扫描，再人工复核 README、Release 文案、作者邮箱、二进制和 ZIP 清单。通用扫描无法识别所有业务隐私；测试仅使用合成资料。
