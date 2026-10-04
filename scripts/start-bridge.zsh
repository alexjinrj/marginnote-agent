#!/bin/zsh
set -euo pipefail
project_dir="${0:A:h:h}"
bridge_node="${MN_BRIDGE_NODE_PATH:-}"
if [[ -z "$bridge_node" ]]; then
  bridge_node="$(command -v node || true)"
fi
if [[ -z "$bridge_node" ]]; then
  bridge_node="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
fi
if [[ ! -x "$bridge_node" ]]; then
  print -u2 'Node.js >=20 is required; set MN_BRIDGE_NODE_PATH to its absolute path.'
  exit 1
fi
exec "$bridge_node" "$project_dir/host/src/bridge-main.mjs"
