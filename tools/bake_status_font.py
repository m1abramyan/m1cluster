#!/usr/bin/env python3
"""Bake the larger mode/status label from the existing approved Roboto face.

Run: .cache/fonts/venv/bin/python tools/bake_status_font.py
Original numeric and label atlases are not regenerated.
"""
from bake_russian_fonts import bake

bake('ru_status', 28, 31, 26)
print('ru_status: existing Roboto Condensed SemiBold, 28px')
