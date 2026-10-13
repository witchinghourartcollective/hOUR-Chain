#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Keep builds usable on development machines with limited RAM.
export GOTOOLCHAIN="${GOTOOLCHAIN:-go1.25.9}"
export GOMAXPROCS="${GOMAXPROCS:-2}"
export GOMEMLIMIT="${GOMEMLIMIT:-1GiB}"

go mod download
go mod verify
mkdir -p build
go build -buildvcs=false -mod=readonly -p "${GO_BUILD_PARALLELISM:-1}" -o build/hourd ./cmd/evmd
build/hourd --help >/dev/null
printf 'Built and checked %s/build/hourd\n' "$PWD"
