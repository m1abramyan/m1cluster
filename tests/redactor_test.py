import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location('redactor', pathlib.Path(__file__).resolve().parent.parent / 'tools/anonymize-log.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class LogRedaction(unittest.TestCase):
    def test_json_and_authorization(self):
        value = module.redact('{"token":"example-secret"}\nAuthorization: Bearer sample-credential\npassword="two words"')
        for secret in ['example-secret', 'sample-credential', 'two words']:
            self.assertNotIn(secret, value)

    def test_identifiers_and_timestamps(self):
        value = module.redact('2026-11-14T14:36:00.123Z rpm=800 2001:db8::1 192.0.2.1 WWW00000000000000 /Users/sample/f oap_1234')
        self.assertIn('2026-11-14T14:36:00.123Z rpm=800', value)
        for identifier in ['2001:db8::1', '192.0.2.1', 'WWW00000000000000', '/Users/sample/', 'oap_1234']:
            self.assertNotIn(identifier, value)

    def test_private_key_block(self):
        value = module.redact('before\n-----BEGIN PRIVATE KEY-----\nsample-not-real\n-----END PRIVATE KEY-----\nafter')
        self.assertNotIn('sample-not-real', value)
        self.assertIn('after', value)
