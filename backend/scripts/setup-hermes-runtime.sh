#!/usr/bin/env bash
set -euo pipefail

backend_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bootstrap_python="${HERMES_BOOTSTRAP_PYTHON:-${backend_dir}/.venv/bin/python}"

if [[ ! -x "${bootstrap_python}" ]]; then
  bootstrap_python="${HERMES_BOOTSTRAP_PYTHON:-python3}"
fi

"${bootstrap_python}" -c '
import sys
if not ((3, 11) <= sys.version_info[:2] < (3, 14)):
    raise SystemExit("Hermes Agent requires Python >=3.11 and <3.14")
'

"${bootstrap_python}" -m venv --clear "${backend_dir}/.hermes-runtime"
"${backend_dir}/.hermes-runtime/bin/python" -m pip install --upgrade pip
"${backend_dir}/.hermes-runtime/bin/pip" install \
  --requirement "${backend_dir}/hermes-runtime-requirements.txt"

"${backend_dir}/.hermes-runtime/bin/python" -c '
import importlib.metadata
from run_agent import AIAgent
assert AIAgent
print("Hermes Agent runtime ready:", importlib.metadata.version("hermes-agent"))
'
