#!/usr/bin/env python3
"""Check publishable source paths for common secrets and local-user paths.
This is a release guard, not a guarantee of anonymization.
"""
from pathlib import Path
import re, subprocess
root=Path(__file__).resolve().parents[1]
try:
 paths=[root / p for p in subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z'],cwd=root,stderr=subprocess.DEVNULL).decode().split('\0') if p]
except subprocess.CalledProcessError:
 paths=[]
if not paths:
 paths=[p for p in root.rglob('*') if p.is_file() and not any(part in {'.git','node_modules','.cache','build','dist'} for part in p.relative_to(root).parts)]
patterns=[('API credential',re.compile(rb'(?:sk-(?:proj-|svcacct-)?|ghp_|gho_|github_pat_)[A-Za-z0-9_-]{20,}')),
 ('real-looking Tunnel ID',re.compile(rb'tunnel_[a-f0-9]{32}')),
 ('local user path',re.compile(rb'/Users/(?!your-user(?:/|$)|example(?:/|$))[A-Za-z0-9_.-]+/')),
 ('private key',re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'))]
forbidden={'settings.json','connection.json','tunnel-health.url','access.jsonl','before.bin','.DS_Store'}
errors=[]
for p in paths:
 rel=str(p.relative_to(root))
 if not p.exists(): continue
 if p.name in forbidden or p.suffix in {'.log','.jsonl','.p12','.pfx'}:
  errors.append((rel,'runtime/private file'))
 data=p.read_bytes()
 for label,pattern in patterns:
  if pattern.search(data): errors.append((rel,label))
if errors:
 for rel,label in errors: print(f'BLOCKED: {rel}: {label}')
 raise SystemExit(1)
print(f'Public source check passed ({len(paths)} files; no values printed)')
