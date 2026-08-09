#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "${project_root}"

run() {
  printf '\n==> %s\n' "$*"
  "$@"
}

run corepack pnpm run typecheck
run corepack pnpm test
run corepack pnpm run test:contracts
run corepack pnpm run test:browser
run corepack pnpm run scenarios -- --small
run corepack pnpm run export:proof
run corepack pnpm run verify:proof
run corepack pnpm run audit:verify
run corepack pnpm run release:gate -- --local

printf '\nProofOps local verification passed.\n'
