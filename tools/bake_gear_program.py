#!/usr/bin/env python3
"""Deprecated command alias: programme letters now share the full-size DSEG atlas.

This does not recreate the obsolete small Roboto gear_program.json atlas.
Run .cache/fonts/venv/bin/python tools/bake_drive_font.py directly for new work.
"""
from bake_drive_font import main

if __name__ == '__main__':
    main()
