#!/usr/bin/env python3
"""Snapshot reviewed development sources for public GitHub publication, never local state."""
import hashlib
import json
import pathlib
import shutil
import stat

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'dist/publication'
FOLDERS = ['apps/manuk_retro_cluster', 'shared', 'kit', 'licenses', 'config', 'docs', 'tools', 'tests', 'bench']
ROOT_FILES = ['README.md', 'LICENSE', '.gitignore', 'UPSTREAM.lock.json', 'mgu-repo.json', 'package.json', 'package-lock.json']
IMAGES = ['reference_retro.png', 'retro_cluster.png', 'diff.png', 'comfort.png', 'sport.png', 'eco.png',
          'idrive_settings_ru.png', 'idrive_settings_en.png', 'idrive_units.png', 'idrive_units_en.png',
          'idrive_engine_waiting.png', 'idrive_units_cluster.png', 'retro-cluster-icon.png',
          'diagnostics_menu_ru.png', 'diagnostics_qr_preview_SIMULATION.png',
          'diagnostic_values_ru_page03_SIMULATION.png', 'diagnostic_values_ru_page05_SIMULATION.png',
          'cluster_centred_FOREIGN_MASK_NOT_G30.png']
FORBIDDEN = {'node_modules', '__pycache__', 'oap-sdk', 'sdk-stub', 'upstream', '.git'}
files = [ROOT / name for name in ROOT_FILES]
for folder in FOLDERS:
    for p in (ROOT / folder).rglob('*'):
        rel = p.relative_to(ROOT)
        if rel.as_posix().startswith('kit/emu/') or rel.as_posix() == 'kit/tools/emu.js':
            continue  # unrelated mgu-renderd emulator; our bench uses cluster-render/WebGL
        if not p.is_file() or p.is_symlink() or any(part in FORBIDDEN or part.startswith('.') for part in rel.parts):
            continue
        if p.suffix in ('.pyc', '.log', '.sock', '.pem', '.key', '.mgu', '.tgz'):
            continue
        files.append(p)
files += [ROOT / 'artifacts' / name for name in IMAGES]
if OUT.exists():
    shutil.rmtree(OUT)  # only this generated publication snapshot, never the working source tree
entries = []
for p in sorted(set(files)):
    if not p.is_file():
        raise SystemExit('Missing reviewed publication file: ' + str(p.relative_to(ROOT)))
    rel = p.relative_to(ROOT).as_posix()
    dest = OUT / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(p, dest)
    data = dest.read_bytes()
    entries.append({'path': rel, 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
                    'mode': '100755' if p.stat().st_mode & stat.S_IXUSR else '100644'})
(ROOT / 'dist/publication-manifest.json').write_text(json.dumps(entries, indent=2) + '\n')
print(json.dumps({'files': len(entries), 'bytes': sum(e['size'] for e in entries), 'snapshot': str(OUT)}, ensure_ascii=False))
