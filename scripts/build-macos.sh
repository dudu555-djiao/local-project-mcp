#!/bin/bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
[[ "$(uname -s)" == Darwin && "$(uname -m)" == arm64 ]] || { echo 'Build requires Apple Silicon macOS'; exit 1; }
runtime="$root/.cache/runtime"
for binary in node tunnel-client cloudflared; do
  [[ -x "$runtime/$binary" ]] || { echo 'Run python3 scripts/download-runtime.py first'; exit 1; }
done
[[ -d node_modules ]] || { echo 'Run npm ci first'; exit 1; }
app="$root/build/本地资料助手.app"
# Only generated build output is replaced; user settings are never read or copied.
rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources/bin" "$app/Contents/Resources/service"
swiftc -O -swift-version 5 -parse-as-library -file-prefix-map "$root=/src/local-reader-mcp" -debug-prefix-map "$root=/src/local-reader-mcp" native/App.swift native/TunnelHealth.swift -o "$app/Contents/MacOS/LocalReader" -framework Cocoa -framework WebKit -framework Security -framework PDFKit
cp -R src ui package.json package-lock.json "$app/Contents/Resources/service/"
# Use production dependencies from a clean locked install, never copy arbitrary dev caches.
cp package.json package-lock.json build/
PATH="$runtime:$PATH" npm ci --prefix build --omit=dev --ignore-scripts --no-audit --no-fund
mv build/node_modules "$app/Contents/Resources/service/node_modules"
rm -f build/package.json build/package-lock.json
cp "$runtime/node" "$runtime/tunnel-client" "$runtime/cloudflared" "$runtime/cloudflared-manifest.json" "$app/Contents/Resources/bin/"
cp -R "$runtime/licenses" "$app/Contents/Resources/"
cp LICENSE THIRD_PARTY_NOTICES.md "$app/Contents/Resources/licenses/"
swift native/Icon.swift build/icon.png
mkdir -p build/AppIcon.iconset
for size in 16 32 128 256 512; do
 sips -z "$size" "$size" build/icon.png --out "build/AppIcon.iconset/icon_${size}x${size}.png" >/dev/null
 double=$((size*2))
 sips -z "$double" "$double" build/icon.png --out "build/AppIcon.iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns build/AppIcon.iconset -o "$app/Contents/Resources/AppIcon.icns"
cat > "$app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>本地资料助手</string>
<key>CFBundleDisplayName</key><string>本地资料助手</string>
<key>CFBundleIdentifier</key><string>io.localreader.mcp</string>
<key>CFBundleExecutable</key><string>LocalReader</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleIconFile</key><string>AppIcon</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
<key>NSDocumentsFolderUsageDescription</key><string>读取你主动添加的项目或资料文件夹。</string>
<key>NSDownloadsFolderUsageDescription</key><string>读取你主动添加的下载资料。</string>
<key>NSDesktopFolderUsageDescription</key><string>读取你主动添加的桌面资料。</string>
</dict></plist>
PLIST
for binary in node tunnel-client cloudflared; do codesign --force --sign - "$app/Contents/Resources/bin/$binary"; done
codesign --force --sign - "$app"
codesign --verify --deep --strict "$app"
echo 'Built build/本地资料助手.app (ad-hoc signature; not notarized)'
