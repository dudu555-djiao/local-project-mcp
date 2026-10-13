# 第三方组件

项目自己的源码使用 MIT。以下组件保留其各自许可证，本文件不改变原始授权条款。

| 组件 | 来源 | 授权 |
| --- | --- | --- |
| Node.js 24.16.0 | https://nodejs.org/dist/v24.16.0/ | Node 官方 LICENSE，含第三方声明 |
| openai/tunnel-client 0.0.15 | https://github.com/openai/tunnel-client/releases/tag/v0.0.15 | 发行包 LICENSE / NOTICE / 依赖许可证与 SPDX 清单 |
| cloudflared（随官方 Tunnel 包） | 同上 | 发行包提供的许可证和第三方声明 |
| @modelcontextprotocol/sdk 1.32.1 | https://github.com/modelcontextprotocol/typescript-sdk | MIT，见安装后依赖 LICENSE |
| zod 3.x 及传递依赖 | package-lock.json 中固定版本 | 各包许可证 |
| Apple 系统框架与工具 | macOS / Xcode SDK | 不在本仓库重新分发系统框架 |
| Electron 44.7.0 / Chromium（Windows） | https://github.com/electron/electron | Electron MIT 与随发行包提供的 Chromium 第三方许可证 |
| electron-builder / NSIS（构建工具） | https://github.com/electron-userland/electron-builder | MIT；NSIS zlib/libpng 及其各自第三方许可证 |
| MinGit 2.56.0.windows.2（Windows） | https://github.com/git-for-windows/git/releases/tag/v2.56.0.windows.2 | GPL-2.0 及发行包内第三方声明；对应源码见同一官方 tag / release |
| PDF.js / pdfjs-dist 6.4.299 | https://github.com/mozilla/pdf.js | Apache-2.0 及包内第三方声明 |
| fflate 0.8.3 | https://github.com/101arrowz/fflate | MIT |
| @xmldom/xmldom 0.9.12 | https://github.com/xmldom/xmldom | MIT |
| rtf-parser 1.3.3 | https://github.com/iarna/rtf-parser | ISC |

下载脚本固定版本并核对官方发行校验清单；构建时将运行环境及其 LICENSE / NOTICE / 依赖许可证一起放入 app 的 Contents/Resources/licenses，npm 依赖保留包内许可证。下载二进制不提交到 Git。构建安装包使用本机临时签名会改变二进制 SHA256，最终下载包校验值由 Release 提供。
