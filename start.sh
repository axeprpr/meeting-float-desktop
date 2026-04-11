#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec env LD_LIBRARY_PATH="$DIR/runtime" "$DIR/runtime/scapp" "$DIR/index.htm"
