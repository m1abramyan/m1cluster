"""Packaging contract checks: temporary bench staging only, never a car artifact.

Run: python3 -W ignore::ResourceWarning tests/build_test.py
"""
import contextlib
import importlib.util
import io
import json
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest
import warnings
import xml.etree.ElementTree as ET
from unittest import mock


ROOT = pathlib.Path(__file__).resolve().parents[1]
APP = 'manuk_retro_cluster'


def load_builder():
    spec = importlib.util.spec_from_file_location('retro_contract_builder', ROOT / 'kit/tools/build.py')
    builder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(builder)
    return builder


def run_build(builder, *args, **kwargs):
    # The inherited builder uses short-lived open(...).read()/json.dump(..., open(...))
    # handles. Python 3.14 unittest enables their normally hidden ResourceWarnings.
    # Suppress that known upstream noise only while invoking this builder.
    with warnings.catch_warnings():
        warnings.simplefilter('ignore', ResourceWarning)
        return builder.build(*args, **kwargs)


class CarBuildRefusal(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='retro-build-guard-')
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.builder = load_builder()
        self.builder.SDK = str(self.root / 'sdk')
        self.builder.DIST = str(self.root / 'dist')

    def assert_no_artifacts(self):
        self.assertEqual(list(self.root.rglob('*.tgz')), [])
        self.assertEqual(list(self.root.rglob('*.mgu')), [])
        self.assertFalse((self.root / 'dist' / APP).exists(), 'Must refuse before staging')

    def test_missing_sdk_refused_before_output(self):
        for start_type in [None, 'autostart', 'manually']:
            with self.subTest(start_type=start_type), self.assertRaisesRegex(SystemExit, 'Real oap-sdk is required'):
                run_build(self.builder, APP, start_type=start_type)
            self.assert_no_artifacts()

    def test_stub_marker_in_index_refused_before_output(self):
        sdk = pathlib.Path(self.builder.SDK)
        sdk.mkdir()
        (sdk / 'index.js').write_text("// BENCH_STUB\nthrow new Error('test only');\n")
        (sdk / 'package.json').write_text(json.dumps({'name': 'oap-sdk', 'version': '0.0.0'}))
        for start_type in [None, 'autostart', 'manually']:
            with self.subTest(start_type=start_type), self.assertRaisesRegex(SystemExit, 'BENCH_STUB'):
                run_build(self.builder, APP, start_type=start_type)
            self.assert_no_artifacts()

    def test_stub_marker_in_package_refused_before_output(self):
        sdk = pathlib.Path(self.builder.SDK)
        sdk.mkdir()
        (sdk / 'index.js').write_text("throw new Error('test only');\n")
        for marker in [{'version': '0.0.0-bench-stub'}, {'mguBenchOnly': True}]:
            with self.subTest(marker=marker):
                (sdk / 'package.json').write_text(json.dumps(dict({'name': 'oap-sdk'}, **marker)))
                with self.assertRaisesRegex(SystemExit, 'BENCH_STUB'):
                    run_build(self.builder, APP)
                self.assert_no_artifacts()

    def test_autostart_requires_explicit_new_version_before_sdk_lookup(self):
        for version in [None, json.loads((ROOT / 'apps' / APP / 'app.json').read_text())['version'], '0.1.0', '0.0.9']:
            with self.subTest(version=version):
                cmd = [sys.executable, str(ROOT / 'tools/build.py'), '--autostart-after-manual-test', APP]
                if version is not None:
                    cmd += ['--version', version]
                result = subprocess.run(cmd, cwd=ROOT, text=True, capture_output=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('autostart requires a new --version', result.stderr)
        self.assert_no_artifacts()


class BenchPackageContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='retro-bench-contract-')
        cls.root = pathlib.Path(cls.temp.name)
        cls.builder = load_builder()
        cls.builder.SDK = str(cls.root / 'sdk-stub')
        cls.builder.DIST = str(cls.root / 'stage')
        sdk = pathlib.Path(cls.builder.SDK)
        sdk.mkdir()
        (sdk / 'index.js').write_text("// BENCH_STUB: contract tests only\nthrow new Error('BENCH_STUB');\n")
        (sdk / 'package.json').write_text(json.dumps({'name': 'oap-sdk', 'version': '0.0.0-bench-stub'}))
        with contextlib.redirect_stdout(io.StringIO()):
            run_build(cls.builder, APP, bench=True)
        cls.source = cls.root / 'stage' / APP / 'source'
        cls.package = json.loads((cls.source / 'package.json').read_text())
        cls.manifest = json.loads((cls.source / 'manifest.json').read_text())

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_stage_is_marked_manual_bench_without_installable_archive(self):
        self.assertEqual(self.package['name'], APP)
        self.assertEqual(self.package['version'], json.loads((ROOT / 'apps' / APP / 'app.json').read_text())['version'])
        self.assertEqual(self.package['mguAppStartType'], 'manually')
        runtime = json.loads((self.source / 'javascript/kit/app-spec.json').read_text())
        self.assertEqual(runtime['mguAppStartType'], 'manually')
        self.assertIs(self.package['mguBenchOnly'], True)
        self.assertEqual(list(self.root.rglob('*.tgz')), [])
        self.assertEqual(list(self.root.rglob('*.mgu')), [])

    def test_entrypoint_is_real_and_unique(self):
        rhmi = json.loads((self.source / 'rhmiData/application.json').read_text())['application']
        self.assertEqual(rhmi['name'], APP)
        self.assertEqual(len(rhmi['entryPoints']), 1)
        self.assertEqual(rhmi['entryPoints'][0]['name'], APP.upper() + '_ENTRY')
        self.assertNotEqual(rhmi['uuid'], self.builder.u('cluster_themes', 'app'))
        self.assertTrue((self.source / self.package['main']).is_file())
        self.assertTrue((self.source / 'javascript/hud.pack').is_file())
        self.assertTrue((self.source / 'javascript/config.pack').is_file())

    def test_genuine_settings_controls_and_unicode_survive_packaging(self):
        spec = json.loads((ROOT / 'apps' / APP / 'app.json').read_text())
        xml, expected, strings, states = self.builder.build_ui(spec)
        self.builder.unicode_resources(expected, strings, 'en')
        self.assertEqual(set(states), {'MAIN', 'LANGUAGE', 'UNITS'})
        installed = self.root / 'stage' / APP / 'rhmiData' / 'uiDescription'
        packaged = self.source / 'rhmiData' / 'uiDescriptions' / 'ID7'
        for directory in (installed, packaged):
            self.assertEqual((directory / 'application.xml').read_text(), xml)
            self.assertEqual(json.loads((directory / 'uiDescription.json').read_text()), expected)
        components = {c['name']: c for state in expected['containers'].values() for c in state['components'].values()}
        names = {s['name'] + '_TITLE' for s in spec['screens']} | {item[1] for s in spec['screens'] for item in s['items']}
        self.assertEqual(set(components), names)
        self.assertEqual(len(components), 17)
        self.assertEqual(spec['settings'], [], 'Do not activate the non-atomic generic settings owner')
        for name in ('SET_ENABLED', 'SET_ENGINE_START', 'LANG_RU', 'LANG_EN'):
            self.assertEqual(components[name]['type'], 'checkBox')
            self.assertEqual(components[name]['properties']['Focusable']['value'], 2)
        for name in ('BTN_LANGUAGE', 'BTN_UNITS', 'UNIT_SPEED', 'UNIT_TEMPERATURE', 'UNIT_PRESSURE', 'UNIT_CONSUMPTION'):
            self.assertEqual(components[name]['type'], 'button')
            self.assertEqual(set(components[name]['rows'][0]), {'Text1stCol', 'Text2ndCol'})
        # Cyrillic labels must be StringBundle IDs, not ASCII text fallbacks.
        for name in ('SET_ENABLED', 'SET_ENGINE_START', 'LANG_RU', 'ENGINE_START_NOTE'):
            cell = components[name]['rows'][0]['Text']
            self.assertEqual(cell['type'], 'StringId')
            self.assertTrue(any(ord(c) > 127 for c in strings[cell['value']]))
        tree = ET.fromstring(xml)
        self.assertEqual(len(tree.findall('container')), 3)
        self.assertIn('LT_CheckBox_1Row', xml)
        self.assertIn('LT_Button_1Row_2Col7030_2Text', xml)
        self.assertIn('LT_Label_3Row_1TextDyn', xml)
        self.assertEqual((self.source / 'javascript/settings_ui.js').read_bytes(),
                         (ROOT / 'apps' / APP / 'settings_ui.js').read_bytes())

    def test_app_icon_is_copied_byte_for_byte_to_both_resource_formats(self):
        icon = (ROOT / 'apps' / APP / 'icon.png').read_bytes()
        self.assertEqual(icon[:8], b'\x89PNG\r\n\x1a\n')
        self.assertLessEqual(len(icon), 128 * 1024)
        self.assertEqual(int.from_bytes(icon[16:20], 'big'), 140)
        self.assertEqual(int.from_bytes(icon[20:24], 'big'), 140)
        self.assertEqual((self.root / 'stage' / APP / 'rhmiData/resources' / (APP + '_icon.png')).read_bytes(), icon)
        self.assertEqual((self.source / 'rhmiData/variantGroups/Common/images' / (APP + '_icon.png')).read_bytes(), icon)

    def test_vehicle_signals_have_only_read_subscribe_permissions(self):
        app_spec = json.loads((ROOT / 'apps' / APP / 'app.json').read_text())
        for interface, fields in app_spec['signals'].items():
            with self.subTest(interface=interface):
                self.assertNotIn('InternalTasu', interface)
                self.assertNotIn('_methods', fields)
                attrs = self.manifest['proxies'][interface]['attributes']
                self.assertTrue(attrs)
                self.assertTrue(all(permission in ('r', 's', 'rs') for permission in attrs.values()))
                self.assertNotIn('methods', self.manifest['proxies'][interface])
        self.assertFalse(any('tasu' in name.lower() for name in self.manifest['proxies']))

    def test_package_carries_authorship_and_renderer_license(self):
        self.assertEqual(self.package['license'], 'SEE LICENSE IN javascript/NOTICE')
        notice = (self.source / 'javascript/NOTICE').read_text()
        self.assertIn('bimmer-lab', notice)
        self.assertIn('Robert Nisipeanu', notice)
        self.assertIn('DSEG', notice)
        mpl = (self.source / 'javascript/licenses/MPL-2.0.txt').read_text()
        self.assertIn('Mozilla Public License Version 2.0', mpl)
        self.assertTrue((self.source / 'javascript/licenses/MGU-App-Kit-MIT.txt').is_file())

    def test_autostart_metadata_survives_bench_staging_only(self):
        # Exercise final package metadata generation with a stub strictly in bench mode.
        # No installable package is produced, including for autostart.
        old_dist = self.builder.DIST
        self.builder.DIST = str(self.root / 'auto-stage')
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                run_build(self.builder, APP, bench=True, start_type='autostart', version='0.1.1')
            package = json.loads((pathlib.Path(self.builder.DIST) / APP / 'source/package.json').read_text())
            self.assertEqual(package['mguAppStartType'], 'autostart')
            runtime = json.loads((pathlib.Path(self.builder.DIST) / APP / 'source/javascript/kit/app-spec.json').read_text())
            self.assertEqual(runtime['mguAppStartType'], 'autostart')
            self.assertEqual(package['version'], '0.1.1')
            self.assertIs(package['mguBenchOnly'], True)
            self.assertEqual(list(self.root.rglob('*.tgz')), [])
            self.assertEqual(list(self.root.rglob('*.mgu')), [])
        finally:
            self.builder.DIST = old_dist

    def test_store_source_policy_and_manual_override_reach_both_manifests(self):
        # The actual source stays manual. This isolated fixture represents a
        # future, explicitly authorized source release built by Store with {id}.
        apps = self.root / 'future-source-apps'
        shutil.copytree(ROOT / 'apps' / APP, apps / APP)
        app_file = apps / APP / 'app.json'
        spec = json.loads(app_file.read_text())
        spec['version'] = '0.3.1'
        spec['mguAppStartType'] = 'autostart'
        app_file.write_text(json.dumps(spec))
        old_apps, old_dist = self.builder.APPS, self.builder.DIST
        try:
            self.builder.APPS = str(apps)
            for name, override, expected in [('declared', None, 'autostart'), ('manual', 'manually', 'manually')]:
                with self.subTest(policy=name):
                    self.builder.DIST = str(self.root / ('source-policy-' + name))
                    with contextlib.redirect_stdout(io.StringIO()):
                        run_build(self.builder, APP, bench=True, start_type=override)
                    source = pathlib.Path(self.builder.DIST) / APP / 'source'
                    package = json.loads((source / 'package.json').read_text())
                    runtime = json.loads((source / 'javascript/kit/app-spec.json').read_text())
                    self.assertEqual(package['version'], '0.3.1')
                    self.assertEqual(runtime['version'], '0.3.1')
                    self.assertEqual(package['mguAppStartType'], expected)
                    self.assertEqual(runtime['mguAppStartType'], expected)
                    self.assertIs(package['mguBenchOnly'], True)
                    self.assertEqual(list(self.root.rglob('*.tgz')), [])
                    self.assertEqual(list(self.root.rglob('*.mgu')), [])
        finally:
            self.builder.APPS, self.builder.DIST = old_apps, old_dist


class SourceWrapperPolicy(unittest.TestCase):
    """Route the real source-build CLI while the real builder enforces SDK rules above."""
    def test_declared_policy_and_explicit_overrides_are_passed_to_car_builder(self):
        module_spec = importlib.util.spec_from_file_location('retro_source_wrapper', ROOT / 'tools/build.py')
        wrapper = importlib.util.module_from_spec(module_spec)
        module_spec.loader.exec_module(wrapper)
        with tempfile.TemporaryDirectory(prefix='retro-wrapper-policy-') as folder:
            wrapper.ROOT = pathlib.Path(folder)
            app_file = wrapper.ROOT / 'apps' / APP / 'app.json'
            app_file.parent.mkdir(parents=True)
            cases = [
                ('manually', [], 'manually', None),
                ('autostart', [], 'autostart', None),
                ('autostart', ['--manual-start'], 'manually', None),
                ('manually', ['--autostart-after-manual-test', '--version', '0.3.1'], 'autostart', '0.3.1'),
                ('autostart', ['--manual-start', '--version', '0.3.2'], 'manually', '0.3.2'),
            ]
            for declared, arguments, expected, version in cases:
                with self.subTest(declared=declared, arguments=arguments):
                    app_file.write_text(json.dumps({'id': APP, 'version': '0.3.0', 'mguAppStartType': declared}))
                    builder = mock.Mock()
                    loader = mock.Mock()
                    with mock.patch.object(sys, 'argv', ['build.py', APP] + arguments), \
                         mock.patch.object(wrapper.importlib.util, 'spec_from_file_location', return_value=loader), \
                         mock.patch.object(wrapper.importlib.util, 'module_from_spec', return_value=builder), \
                         mock.patch.object(wrapper, 'inspect_archive', return_value={'mguAppStartType': expected}) as inspect, \
                         contextlib.redirect_stdout(io.StringIO()):
                        wrapper.main()
                    builder.build.assert_called_once_with(APP, start_type=expected, version=version)
                    self.assertNotIn('bench', builder.build.call_args.kwargs, 'Source CLI must never opt into stub staging')
                    inspect.assert_called_once_with(wrapper.ROOT / 'dist' / (APP + '@' + (version or '0.3.0') + '.tgz'), expected)

    def test_conflicting_and_invalid_policies_are_rejected_before_sdk_lookup(self):
        module_spec = importlib.util.spec_from_file_location('retro_bad_source_wrapper', ROOT / 'tools/build.py')
        wrapper = importlib.util.module_from_spec(module_spec)
        module_spec.loader.exec_module(wrapper)
        with tempfile.TemporaryDirectory(prefix='retro-wrapper-reject-') as folder:
            wrapper.ROOT = pathlib.Path(folder)
            app_file = wrapper.ROOT / 'apps' / APP / 'app.json'
            app_file.parent.mkdir(parents=True)
            for declared, arguments in [('boot', []), ('manually', ['--manual-start', '--autostart-after-manual-test', '--version', '0.3.1'])]:
                with self.subTest(declared=declared, arguments=arguments):
                    app_file.write_text(json.dumps({'id': APP, 'version': '0.3.0', 'mguAppStartType': declared}))
                    with mock.patch.object(sys, 'argv', ['build.py', APP] + arguments), \
                         mock.patch.object(wrapper.importlib.util, 'spec_from_file_location') as lookup, \
                         contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                        wrapper.main()
                    lookup.assert_not_called()


class StoreSourceContract(unittest.TestCase):
    def test_catalog_exposes_one_id7_app_with_no_install_or_network_hooks(self):
        repo = json.loads((ROOT / 'mgu-repo.json').read_text())
        self.assertEqual(repo['schema'], 1)
        self.assertEqual([c['id'] for c in repo['components']], [APP])
        self.assertNotIn('apps', repo)
        self.assertNotIn('tools', repo)
        entry = repo['components'][0]
        self.assertEqual(entry['kind'], 'app')
        self.assertEqual(entry['mguHmi'], ['ID7'])
        self.assertEqual(entry['path'], 'apps/' + APP)
        self.assertNotIn('activate', entry)
        self.assertNotIn('deactivate', entry)
        build = entry['build']
        self.assertEqual(build['args'], ['{id}'])
        self.assertEqual(build['sdk'], 'oap-sdk')
        self.assertEqual(build['output'], 'dist/{id}@{version}.tgz')
        self.assertNotIn('network', build)
        self.assertTrue((ROOT / build['python']).is_file())

    def test_delivered_schema_and_examples_match_runtime_defaults(self):
        runtime = ROOT / 'apps' / APP / 'config'
        self.assertEqual(json.loads((ROOT / 'config/schema.json').read_text()),
                         json.loads((runtime / 'schema.json').read_text()))
        for profile in ['car', 'bench']:
            self.assertEqual(json.loads((ROOT / 'config' / (profile + '.example.json')).read_text()),
                             json.loads((runtime / ('defaults-' + profile + '.json')).read_text()))
        car = json.loads((runtime / 'defaults-car.json').read_text())
        self.assertFalse(car['enabled'])
        self.assertEqual(car['startup']['mode'], 'manually')
        self.assertIsNone(car['retro']['tankLitres'])
        self.assertEqual(car['timeZone']['utcOffsetMinutes'], 240)


if __name__ == '__main__':
    unittest.main(verbosity=2)
