#!/usr/bin/env python3
"""Stage only source allowlisted for the shipped backend."""
from pathlib import Path
import shutil

root = Path(__file__).resolve().parents[1]
stage = root / 'build/windows-service'
if stage.exists():
    shutil.rmtree(stage)
stage.mkdir(parents=True)
for directory in ['src', 'ui']:
    for file in (root / directory).rglob('*'):
        if file.is_symlink():
            raise SystemExit('Source symlinks cannot be packaged.')
        if file.is_file():
            if file.suffix not in {'.js', '.html', '.css'}:
                raise SystemExit('Unexpected file in source allowlist.')
            dest = stage / file.relative_to(root)
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(file, dest)
for name in ['package.json', 'package-lock.json', 'LICENSE']:
    shutil.copyfile(root / name, stage / name)
print('Staged backend source only; install locked production dependencies in build/windows-service next.')
