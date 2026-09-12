#!/usr/bin/env bash
set -euo pipefail
python -m compileall -q .
python main.py
