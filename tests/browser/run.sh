#!/usr/bin/env bash
set -euo pipefail

browser_python="${PROOFOPS_BROWSER_PYTHON:-python3}"
if [[ -x ".venv-browser/bin/python" ]]; then
  browser_python=".venv-browser/bin/python"
fi

if ! "${browser_python}" -c "import importlib.util; raise SystemExit(0 if importlib.util.find_spec('playwright') else 1)" ; then
  echo "Playwright Python package is not installed in ${browser_python}."
  echo "Install once with:"
  echo "  python -m pip install -r requirements-browser.txt"
  echo "  python -m playwright install --with-deps chromium"
  echo "Then rerun: corepack pnpm run test:browser"
  exit 1
fi

if ! "${browser_python}" - <<'PY'
from playwright.sync_api import sync_playwright

try:
  with sync_playwright() as playwright:
    chromium_path = playwright.chromium.executable_path
    if not chromium_path:
      raise RuntimeError("Chromium executable path is not available")
except Exception:
  raise SystemExit(1)
PY
then
  echo "Playwright browsers are not installed or not provisioned for '${browser_python}'."
  echo "Run once:"
  echo "  python -m playwright install --with-deps chromium"
  echo "Then rerun: corepack pnpm run test:browser"
  exit 1
fi

"${browser_python}" tests/browser/proofops.spec.py
