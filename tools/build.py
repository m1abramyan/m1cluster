#!/usr/bin/env python3
"""Build only Retro Cluster. A genuine local SDK or Store donor is required."""
import argparse
import importlib.util
import json
import pathlib
import re
import tarfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
APP = 'manuk_retro_cluster'


def inspect_archive(file, expected_start):
    with tarfile.open(file, 'r:gz') as archive:
        package = json.load(archive.extractfile('package/package.json'))
        if package['name'] != APP or package.get('mguAppStartType') != expected_start:
            raise RuntimeError('Package identity/start type did not survive packaging')
        if package.get('mguBenchOnly'):
            raise RuntimeError('Bench package refused')
        sdk = archive.extractfile('package/node_modules/oap-sdk/index.js').read()
        if b'BENCH_STUB' in sdk or b'bench-stub' in sdk:
            raise RuntimeError('Bench SDK refused')
        manifest = json.load(archive.extractfile('package/manifest.json'))
        if 'com.harman.infotainment.systemfunctions.tasu.tasu.InternalTasu' in manifest['proxies']:
            raise RuntimeError('Unexpected diagnostic permission')
        return package


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('app', choices=[APP])
    parser.add_argument('--autostart-after-manual-test', action='store_true', help='Explicit opt-in after checking disable and original display on the parked car')
    parser.add_argument('--version', help='A new version is required for an opt-in autostart update')
    args = parser.parse_args()
    base = json.loads((ROOT / 'apps' / APP / 'app.json').read_text())
    if args.version and not re.fullmatch(r'\d+\.\d+\.\d+', args.version):
        parser.error('version must be x.y.z')
    if args.autostart_after_manual_test and (not args.version or tuple(map(int, args.version.split('.'))) <= tuple(map(int, base['version'].split('.')))):
        parser.error('autostart requires a new --version greater than ' + base['version'])
    start = 'autostart' if args.autostart_after_manual_test else 'manually'
    spec = importlib.util.spec_from_file_location('retro_build', ROOT / 'kit/tools/build.py')
    builder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(builder)
    builder.build(APP, start_type=start, version=args.version)
    archive = ROOT / 'dist' / (APP + '@' + (args.version or base['version']) + '.tgz')
    pkg = inspect_archive(archive, start)
    print('Verified package identity and mguAppStartType=' + pkg['mguAppStartType'])


if __name__ == '__main__':
    main()
