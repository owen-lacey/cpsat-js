cmake_minimum_required(VERSION 3.18)
project(ortools-wasm LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include(FetchContent)

# ── OR-Tools configuration: disable everything except CP-SAT core ──
set(BUILD_DEPS ON CACHE BOOL "" FORCE)
set(BUILD_SAMPLES OFF CACHE BOOL "" FORCE)
set(BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(BUILD_TESTING OFF CACHE BOOL "" FORCE)
set(BUILD_PYTHON OFF CACHE BOOL "" FORCE)
set(BUILD_JAVA OFF CACHE BOOL "" FORCE)
set(BUILD_DOTNET OFF CACHE BOOL "" FORCE)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)

# Disable all optional solvers
set(USE_COINOR OFF CACHE BOOL "" FORCE)
set(USE_GLPK OFF CACHE BOOL "" FORCE)
set(USE_HIGHS OFF CACHE BOOL "" FORCE)
set(USE_SCIP OFF CACHE BOOL "" FORCE)
set(USE_CPLEX OFF CACHE BOOL "" FORCE)
set(USE_XPRESS OFF CACHE BOOL "" FORCE)

# Protobuf: don't build protoc (we only need the runtime library for WASM)
set(protobuf_BUILD_PROTOC_BINARIES OFF CACHE BOOL "" FORCE)
set(protobuf_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(protobuf_BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)

# Abseil: disable testing
set(ABSL_BUILD_TESTING OFF CACHE BOOL "" FORCE)
set(ABSL_PROPAGATE_CXX_STD ON CACHE BOOL "" FORCE)

FetchContent_Declare(
  or-tools
  GIT_REPOSITORY https://github.com/google/or-tools.git
  GIT_TAG        v9.12
  GIT_SHALLOW    TRUE
)
FetchContent_MakeAvailable(or-tools)

# ── Our thin WASM entry point ──
add_executable(cpsat_wasm src/cpp/cpsat_api.cpp)
target_link_libraries(cpsat_wasm PRIVATE ortools::ortools)

# ── Emscripten-specific settings ──
if(EMSCRIPTEN)
  set_target_properties(cpsat_wasm PROPERTIES
    OUTPUT_NAME "cpsat"
    SUFFIX ".mjs"
  )
  target_link_options(cpsat_wasm PRIVATE
    -O3
    -flto
    "SHELL:-s MODULARIZE=1"
    "SHELL:-s EXPORT_ES6=1"
    "SHELL:-s EXPORT_NAME='createCpSatModule'"
    "SHELL:-s ALLOW_MEMORY_GROWTH=1"
    "SHELL:-s STACK_SIZE=4194304"
    "SHELL:-s INITIAL_MEMORY=67108864"
    "SHELL:-s EXPORTED_FUNCTIONS=['_solve','_get_result_ptr','_free_result','_malloc','_free']"
    "SHELL:-s EXPORTED_RUNTIME_METHODS=['ccall','cwrap','HEAPU8']"
    "SHELL:-s ENVIRONMENT='web,node'"
  )
endif()
