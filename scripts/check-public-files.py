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
 ('real-looking organization ID',re.compile(rb'org[-_][A-Za-z0-9]{12,}')),
 ('local user path',re.compile(rb'/Users/(?!your-user(?:/|$)|example(?:/|$))[A-Za-z0-9_.-]+/')),
 ('Linux user path',re.compile(rb'/home/(?!(?:your-user|example)(?:/|$))[A-Za-z0-9_.-]+/')),
 ('Windows user path',re.compile(rb'[A-Za-z]:[\\/]+Users[\\/]+(?!(?:your-user|example)[\\/])[A-Za-z0-9_.-]+[\\/]+')),
 ('private key',re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'))]
email_pattern=re.compile(rb'[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})')
def synthetic_email(domain):
 domain=domain.lower()
 return domain in {b'example.com',b'example.org',b'example.net'} or domain.endswith((b'.test',b'.invalid',b'.example'))
forbidden={'settings.json','connection.json','tunnel-health.url','access.jsonl','before.bin','.DS_Store'}
private_dirs={'LocalReaderMCP','editing','proposals','backups'}
private_suffixes={'.log','.jsonl','.bin','.db','.sqlite','.sqlite3','.key','.pem','.p12','.pfx','.zip','.dmg'}
def has_symlink_component(p):
 while p != root:
  if p.is_symlink(): return True
  p=p.parent
 return False
errors=[]
for p in paths:
 rel=str(p.relative_to(root))
 if has_symlink_component(p):
  errors.append((rel,'symlink requires explicit publication review'))
  continue
 if not p.exists(): continue
 private_path=(
  p.name in forbidden
  or p.suffix.lower() in private_suffixes
  or re.search(r'\.(?:log|jsonl|db|sqlite3?)(?:\.[^/]+)?$',p.name,re.I)
  or any(part in private_dirs or part.endswith('.app') for part in p.relative_to(root).parts)
  or (p.name.startswith('.env') and p.name != '.env.example')
 )
 if private_path:
  errors.append((rel,'runtime/private file'))
 data=p.read_bytes()
 for label,pattern in patterns:
  if pattern.search(data): errors.append((rel,label))
 if any(not synthetic_email(match.group(1)) for match in email_pattern.finditer(data)):
  errors.append((rel,'non-example email address requires publication review'))
if errors:
 for rel,label in errors: print(f'BLOCKED: {rel}: {label}')
 raise SystemExit(1)
print(f'Public source check passed ({len(paths)} files; no values printed)')
