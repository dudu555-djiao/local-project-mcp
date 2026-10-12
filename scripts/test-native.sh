#!/bin/bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
mkdir -p build
swiftc -parse-as-library native/TunnelHealth.swift tests/TunnelHealthTests.swift -o build/test-tunnel-health
build/test-tunnel-health
