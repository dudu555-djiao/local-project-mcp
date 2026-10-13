# Agent guide

Local Project MCP is a local project assistant for reading and opt-in UTF-8 text editing, with a native macOS manager. Each user connects their own ChatGPT plugin through their own OpenAI Tunnel. New folders and folders upgraded from older versions default to read-only.

## Start and check

- Use Node.js 24 or later and install locked dependencies with `npm ci`.
- Run `npm start` for the local HTTP service or `npm run stdio` for stdio MCP.
- Run `npm test`, `bash scripts/test-native.sh` on macOS, and `npm run check:privacy` before publishing changes.
- See `docs/DEVELOPMENT.md` for native build and packaging commands. Build only when an app artifact is needed; generated app copies can appear as duplicate applications in macOS search.

## Source layout

- `src/`: folder permissions, readers, editing engine, MCP tools and local HTTP service.
- `native/`, `windows/` and `ui/`: macOS / Windows hosts and the shared management interface.
- `tests/`: synthetic fixtures and Node / Swift checks.
- `scripts/`: reproducible runtime download, build, release and privacy checks.
- `docs/`: setup, development, troubleshooting and verified release evidence.

## Boundaries

- Work only in this repository unless the user explicitly requests another location. Sibling work folders, installed apps and user profiles are not source inputs for publishing.
- Preserve separate local-admin and remote-MCP permissions. Remote tools must not add folders, enable editing or bypass pause, path and version checks.
- Editing follows read version → prepare preview → confirm → apply → read back. This release does not execute arbitrary commands, SQL, file deletion, Git publishing or deployment.
- Do not test writes against real projects. Use temporary synthetic folders, and remove their access grants after an interactive acceptance test.
- Do not change API keys, Keychain entries or user connection settings as part of repository maintenance.

## Privacy and publication

- Publish only reviewed source, synthetic tests and general documentation. Never add private settings, credentials, authorized folder lists, logs, proposals, raw backups, personal screenshots or real project contents.
- Keep `node_modules/`, `.cache/`, `build/`, `dist/` and app bundles out of Git. Inspect the staged file list and diff before pushing; do not force-add ignored files.
- Release packaging must use an explicit allowlist and a clean build from this source. Never package an installed app together with its user profile.
- Privacy checks must report file names and issue categories, never matching credential values. A passing pattern scan is not a guarantee of anonymization; review the actual upload scope too.
- Keep current usage in `README.md` / `docs/`; record verified results in `docs/VERIFICATION.md`. Do not describe SDK tests as proof of web-model behavior.
- This repository does not authorize changes to personal or generated agent memories.

## Current release

The source version is `0.2.0-beta.2`, adding a Windows x64 desktop host and NSIS package workflow. The existing Mac installer remains `0.2.0-beta.1`. Check Releases and `docs/VERIFICATION.md` for actual package and validation status. The public name is 本地项目助手 / Local Project MCP. Preserve Mac compatibility identifiers: `LocalReaderMCP` app data, `io.localreader.mcp` bundle ID, `io.localreader.mcp.tunnel` Keychain service, `LocalReader` executable, and `LOCALREADER_*` variables and headers. Windows uses its own `%LOCALAPPDATA%/LocalReaderMCP` profile with DPAPI-encrypted keys. Never import a user's Mac profile into a distributable build. Run the Windows workflow's packaged acceptance before release; its synthetic SDK / UI evidence must not be represented as live ChatGPT Tunnel verification.
