#!/bin/bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
[[ -d build/本地项目助手.app ]] || { echo 'Build the app first'; exit 1; }
python3 scripts/check-public-files.py
stage="$root/build/release-stage"
rm -rf "$stage"
mkdir -p "$stage/docs" dist
# Explicit allowlist: never include any user settings, audit, keychain or local project data.
cp -R build/本地项目助手.app "$stage/"
cp README.md "$stage/开始使用.md"
cp docs/*.md "$stage/docs/"
cp LICENSE PRIVACY.md THIRD_PARTY_NOTICES.md CONTRIBUTING.md SECURITY.md CHANGELOG.md "$stage/"
find "$stage" -name .DS_Store -delete
# Avoid resource forks, quarantine metadata, and incidental Finder attributes in the archive.
COPYFILE_DISABLE=1 /usr/bin/ditto -c -k --norsrc --noextattr --noqtn "$stage" dist/LocalProject-0.2.0-beta.2-macos-arm64.zip
(cd dist && shasum -a 256 LocalProject-0.2.0-beta.2-macos-arm64.zip > SHA256SUMS.txt)
echo 'Packaged dist/LocalProject-0.2.0-beta.2-macos-arm64.zip'
