#!/usr/bin/env python3
"""Redact common identifiers from a LOCAL log; review output before sharing."""
import argparse
import ipaddress
import pathlib
import re


def redact(text):
    text = re.sub(r'-----BEGIN [^-]*PRIVATE KEY-----.*?-----END [^-]*PRIVATE KEY-----', '[PRIVATE KEY REMOVED]', text, flags=re.S)
    text = re.sub(r'(?i)(["\'](?:password|passwd|token|authorization|secret)["\']\s*:\s*)["\'][^"\']*["\']', r'\1"[SECRET REMOVED]"', text)
    text = re.sub(r'(?im)(\bauthorization\s*:\s*)[^\r\n]+', r'\1[SECRET REMOVED]', text)
    text = re.sub(r'(?i)\b(?:password|passwd|token|secret)\b\s*[:=]\s*(?:"[^"]*"|\'[^\']*\'|[^\s,;]+)', '[SECRET REMOVED]', text)
    text = re.sub(r'(?<![A-Z0-9])[A-HJ-NPR-Z0-9]{17}(?![A-Z0-9])', '[VIN/ID]', text)
    text = re.sub(r'\b(?:\d{1,3}\.){3}\d{1,3}\b', '[IP]', text)
    text = re.sub(r'(?i)\b(?:[0-9a-f]{2}:){5}[0-9a-f]{2}\b', '[MAC]', text)
    def ipv6(match):
        try:
            return '[IPv6]' if ipaddress.ip_address(match.group()).version == 6 else match.group()
        except ValueError:
            return match.group()
    text = re.sub(r'(?i)(?<!\w)[0-9a-f]*:[0-9a-f:]+(?!\w)', ipv6, text)
    text = re.sub(r'/Users/[^/\s]+', '/Users/[USER]', text)
    text = re.sub(r'\boap_\d+\b', 'oap_[UID]', text)
    return text


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    source, dest = pathlib.Path(args.input), pathlib.Path(args.output)
    if source.resolve() == dest.resolve():
        parser.error('Output must differ from original')
    with dest.open('x') as out:
        out.write(redact(source.read_text(errors='replace')))
    print('Redacted local copy. Review for names, locations and unrecognized identifiers before sharing.')


if __name__ == '__main__':
    main()
