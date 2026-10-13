# Agent guide

Local Project MCP is a local project assistant for reading and opt-in UTF-8 text editing, with a native macOS manager. Each user connects their own ChatGPT plugin through their own OpenAI Tunnel. New folders and folders upgraded from older versions default to read-only.

## Start and check

- Use Node.js 24 or later and install locked dependencies with `npm ci`.
- Run `npm start` for the local HTTP service or `npm run stdio` for stdio MCP.
- Run `npm test`, `bash scripts/test-native.sh` on macOS, and `npm run check:privacy` before publishing changes.
- See `docs/DEVELOPMENT.md` for native build and packaging commands. Build only when an app artifact is needed; generated app copies can appear as duplicate applications in macOS search.

## Source layout

- `src/`: folder permissions, readers, editing engine, MCP tools and local HTTP service.
- `native/` and `ui/`: the macOS host and its local management interface.
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

The release line is `0.2.0-beta.2`. The public name is 本地项目助手 / Local Project MCP and the repository slug is `local-project-mcp`. Preserve compatibility identifiers: `LocalReaderMCP` app data, `io.localreader.mcp` bundle ID, `io.localreader.mcp.tunnel` Keychain service, `LocalReader` internal executable, and `LOCALREADER_*` environment variables and existing headers. Do not rename them as a cosmetic cleanup. Web editing and native backup restoration were verified on beta.1 with synthetic UTF-8 data; beta.2 checks are recorded separately in `docs/VERIFICATION.md`.
