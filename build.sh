#!/bin/bash
set -euo pipefail

# Ensure Homebrew Python (>= 3.10) takes precedence over system Python 3.9
# Emscripten's scripts use `list[str] | None` syntax which requires Python 3.10+
if [ -d "/opt/homebrew/bin" ]; then
  export PATH="/opt/homebrew/bin:$PATH"
fi

BUILD_DIR="build"
mkdir -p "$BUILD_DIR"

echo "=== Stage 1: Configure with Emscripten ==="
emcmake cmake -B "$BUILD_DIR" -S . \
  -DCMAKE_BUILD_TYPE=Release \
  -G Ninja

echo "=== Stage 2: Patch build.ninja for cross-compilation ==="
# Fix 1: Remove self-referencing phony rule that conflicts with CUSTOM_COMMAND
# OR-Tools generates a duplicate rule for host_tools
sed -i.bak 's|build _deps/or-tools-build/host_tools: phony _deps/or-tools-build/CMakeFiles/host_tools _deps/or-tools-build/host_tools|# patched: removed conflicting phony\nbuild _deps/or-tools-build/host_tools/bin/protoc: phony _deps/or-tools-build/host_tools|' "$BUILD_DIR/build.ninja"

# Fix 2: Force native compiler + C++17 for host_tools sub-build
# emmake pollutes CC/CXX with emcc/em++, but host_tools needs native protoc
sed -i.bak 's|/opt/homebrew/bin/cmake -S\. -Bbuild -DCMAKE_BUILD_TYPE=Release -DCMAKE_RUNTIME_OUTPUT_DIRECTORY|CC=/usr/bin/clang CXX=/usr/bin/clang++ /opt/homebrew/bin/cmake -S. -Bbuild -DCMAKE_BUILD_TYPE=Release -DCMAKE_C_COMPILER=/usr/bin/clang -DCMAKE_CXX_COMPILER=/usr/bin/clang++ -DCMAKE_CXX_STANDARD=17 -DCMAKE_RUNTIME_OUTPUT_DIRECTORY|' "$BUILD_DIR/build.ninja"

rm -f "$BUILD_DIR/build.ninja.bak"

echo "=== Stage 3: Build ==="
NPROC=$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)
emmake ninja -C "$BUILD_DIR" cpsat_wasm -j"$NPROC"

echo "=== Stage 4: Rename JS glue to .cjs for ESM compatibility ==="
cp "$BUILD_DIR/cpsat.js" "$BUILD_DIR/cpsat.cjs"

echo "=== Done ==="
ls -lh "$BUILD_DIR"/cpsat.{cjs,wasm} 2>/dev/null || echo "Warning: output files not found"
