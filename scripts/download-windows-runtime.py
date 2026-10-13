#!/usr/bin/env python3
"""Fetch pinned official Windows x64 runtimes; never package a user profile."""
from pathlib import Path, PurePosixPath
import hashlib, io, json, shutil, urllib.request, zipfile

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / '.cache/windows-runtime'
PACKAGES = {
    'node': ('https://nodejs.org/dist/v24.16.0/node-v24.16.0-win-x64.zip', 'edaca9bd58ec8e92037dac4e877d52f6b8f430b81c18b57e264b4e2fb111cd56'),
    'tunnel': ('https://github.com/openai/tunnel-client/releases/download/v0.0.15/tunnel-client-v0.0.15-windows-amd64.zip', '3b53133a1e24d43f63088d843860cb1701a4c3ed6390de2e19f69089e43bddc1'),
    'git': ('https://github.com/git-for-windows/git/releases/download/v2.56.0.windows.2/MinGit-2.56.0.2-64-bit.zip', 'da35e72aa21c005a5a0d298cfbae110bc1609a815730ea0dde84b01a1b3cd3be'),
}

def download(url, expected):
    request = urllib.request.Request(url, headers={'User-Agent': 'LocalProjectMCP-build'})
    with urllib.request.urlopen(request, timeout=120) as response:
        data = response.read()
    if hashlib.sha256(data).hexdigest() != expected:
        raise SystemExit('Official archive checksum mismatch; refusing to package.')
    return zipfile.ZipFile(io.BytesIO(data))

def safe_path(name):
    path = PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts or '\\' in name or ':' in name:
        raise SystemExit('Unsafe official archive member.')
    return path

if DEST.exists():
    shutil.rmtree(DEST)
(DEST / 'licenses').mkdir(parents=True)
for package, (url, expected) in PACKAGES.items():
    with download(url, expected) as archive:
        for info in archive.infolist():
            member = safe_path(info.filename)
            if (info.external_attr >> 16) & 0o170000 == 0o120000:
                raise SystemExit('Archive symlink is not allowed.')
            if info.is_dir():
                continue
            if package == 'node':
                if member.name not in {'node.exe', 'LICENSE'}:
                    continue
                output = DEST / ('node.exe' if member.name == 'node.exe' else 'licenses/Node-LICENSE.txt')
            elif package == 'git':
                output = DEST / 'git' / str(member)
            else:
                output = DEST / str(member)
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(archive.read(info))
    print('Verified and extracted official ' + package + ' runtime.')
for filename in ['node.exe', 'tunnel-client.exe', 'cloudflared.exe', 'git/cmd/git.exe']:
    if not (DEST / filename).is_file():
        raise SystemExit('Missing required Windows runtime: ' + filename)
(DEST / 'runtime-manifest.json').write_text(json.dumps({k:{'url':v[0], 'sha256':v[1]} for k,v in PACKAGES.items()}, indent=2) + '\n', encoding='utf-8')
