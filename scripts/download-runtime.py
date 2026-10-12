#!/usr/bin/env python3
"""Download only pinned public runtime archives, verify SHA256, then unpack."""
import hashlib, json, os, pathlib, shutil, subprocess, tarfile, zipfile
ROOT = pathlib.Path(__file__).resolve().parents[1]
CACHE = ROOT / '.cache'
RUNTIME = CACHE / 'runtime'
PACKAGES = {
 'node': ('https://nodejs.org/dist/v24.16.0/node-v24.16.0-darwin-arm64.tar.gz', '39189dab4eeb15706c424af0ac08a3044c9e48f7db12a7d77f6b7aafc7dd5df6'),
 'tunnel': ('https://github.com/openai/tunnel-client/releases/download/v0.0.15/tunnel-client-v0.0.15-darwin-arm64.zip', 'b2cae3aa9df45b4c2fe9b1d700ebacce39f9feb6a6b46b86e6499f9a51bf72ff'),
}
CACHE.mkdir(exist_ok=True)
RUNTIME.mkdir(exist_ok=True)
licenses = RUNTIME / 'licenses'
licenses.mkdir(exist_ok=True)
for kind, (url, expected) in PACKAGES.items():
 archive = CACHE / url.rsplit('/', 1)[1]
 if not archive.exists():
  temp=archive.with_name(archive.name+'.partial')
  subprocess.run(['curl','--fail','--location','--retry','2','--connect-timeout','15','--max-time','600','--output',str(temp),url],check=True)
  temp.replace(archive)
 digest=hashlib.sha256(archive.read_bytes()).hexdigest()
 if digest != expected:
  raise SystemExit(f'SHA256 mismatch: {archive.name}; remove the archive and retry')
 if kind == 'node':
  with tarfile.open(archive) as tar:
   for member, dest in [('bin/node',RUNTIME/'node'),('LICENSE',licenses/'Node-LICENSE.txt')]:
    data=tar.extractfile('node-v24.16.0-darwin-arm64/'+member).read()
    dest.write_bytes(data)
 else:
  with zipfile.ZipFile(archive) as z:
   for name in ['tunnel-client','cloudflared','cloudflared-manifest.json']:
    (RUNTIME/name).write_bytes(z.read(name))
   for name in z.namelist():
    if '/' not in name and (name in ['LICENSE','NOTICE'] or name.endswith(('-licenses.txt','.spdx.json'))):
     (licenses/name).write_bytes(z.read(name))
for name in ['node','tunnel-client','cloudflared']:
 (RUNTIME/name).chmod(0o755)
print('Verified official runtime archives; ready in .cache/runtime')
