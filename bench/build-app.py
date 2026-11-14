#!/usr/bin/env python3
"""Stage-only stub build for the Mac. NEVER emits an installable archive."""
import importlib.util, json, pathlib, re, sys
if len(sys.argv) != 4:
    raise SystemExit('Usage: build-app.py SOURCE_ROOT APP_ID INSTANCE_BUILD_ROOT (bench stage only)')
project = pathlib.Path(__file__).resolve().parent.parent
source = pathlib.Path(sys.argv[1]).resolve()
app_id = sys.argv[2]
if not re.fullmatch(r'[A-Za-z0-9_-]+', app_id):
    raise SystemExit('Invalid app identifier')
# Use our audited stage-only builder; source paths can point at the pinned original.
spec = importlib.util.spec_from_file_location('retro_builder', project / 'kit/tools/build.py')
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)
# Each running server owns this directory. A second bench must never remove its live stage.
root = pathlib.Path(sys.argv[3]).resolve()
sdk = root / 'sdk-stub'
sdk.mkdir(parents=True, exist_ok=True)
(sdk / 'index.js').write_text("'use strict';\n// BENCH_STUB: local testing only, never install.\nthrow new Error('BENCH_STUB');\n")
(sdk / 'package.json').write_text(json.dumps({'name':'oap-sdk','version':'0.0.0-bench-stub','main':'index.js'}))
b.ROOT = str(source)
b.KIT = str(source / 'kit')
b.APPS = str(source / 'apps')
b.DIST = str(root)
b.SDK = str(sdk)
b.build(app_id, bench=True)
# Explicitly mark the staged spec so an environment variable alone cannot enable synthetic data on MGU.
staged_spec = root / app_id / 'source/javascript/kit/app-spec.json'
meta = json.loads(staged_spec.read_text())
meta.setdefault('config', {})['retroProfile'] = 'bench'
staged_spec.write_text(json.dumps(meta, indent=2) + '\n')
