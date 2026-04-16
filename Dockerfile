FROM emscripten/emsdk:3.1.73

RUN apt-get update && apt-get install -y --no-install-recommends \
    ninja-build \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src

# Copy build files first (better layer caching)
COPY CMakeLists.txt build.sh ./
COPY src/cpp/ src/cpp/

RUN ./build.sh

# Copy output for extraction
RUN mkdir -p /output && cp build/cpsat.js build/cpsat.wasm /output/
