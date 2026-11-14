#!/usr/bin/env python3
"""Create an allowlisted Store source archive, without SDK, state, or other apps."""
import hashlib
import json
import pathlib
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
APP = 'manuk_retro_cluster'
spec = json.loads((ROOT / 'apps' / APP / 'app.json').read_text())
out = ROOT / 'dist' / (APP + '-source-' + spec['version'] + '.zip')
out.parent.mkdir(exist_ok=True)
files = []
for folder in ['apps/' + APP, 'shared', 'kit', 'licenses', 'config', 'docs']:
    files += [p for p in (ROOT / folder).rglob('*') if p.is_file() and not p.is_symlink() and '__pycache__' not in p.parts and p.suffix not in ('.pyc', '.log') and p.name not in ('hu-stub.js', 'emu.js') and not p.relative_to(ROOT).as_posix().startswith('kit/emu/')]
for name in ['mgu-repo.json', 'LICENSE', 'README.md', 'UPSTREAM.lock.json', 'tools/build.py', 'tools/config.js', 'tools/anonymize-log.py', 'tools/inspect-signals.js', 'tools/read-diagnostics.js', 'tools/find-rpm-limit.js']:
    p = ROOT / name
    if not p.is_file():
        raise SystemExit('Missing required source: ' + name)
    files.append(p)
with zipfile.ZipFile(out, 'w', compression=zipfile.ZIP_DEFLATED) as z:
    for p in sorted(set(files)):
        rel = p.relative_to(ROOT).as_posix()
        if p.suffix in ('.pem', '.key') or 'oap-sdk' in p.parts:
            raise SystemExit('Forbidden source artifact: ' + rel)
        z.write(p, rel)
digest = hashlib.sha256(out.read_bytes()).hexdigest()
out.with_suffix('.zip.sha256').write_text(digest + '  ' + out.name + '\n')
print(str(out))
print('Source only: unpack into USB/mgu-repo/manuk-retro-cluster/. No installable SDK/package included.')
