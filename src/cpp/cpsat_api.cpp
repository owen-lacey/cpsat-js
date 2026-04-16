// Copyright 2024 ortools-wasm contributors
// Licensed under the Apache License, Version 2.0

#include <emscripten/emscripten.h>
#include <cstdlib>

extern "C" {
void SolveCpModelWithParameters(const void* creq, int creq_len,
                                const void* cparams, int cparams_len,
                                void** cres, int* cres_len);
}

static void* g_result = nullptr;
static int g_result_len = 0;

extern "C" {

EMSCRIPTEN_KEEPALIVE
int solve(const void* model_bytes, int model_len,
          const void* params_bytes, int params_len) {
  if (g_result) {
    free(g_result);
    g_result = nullptr;
  }
  SolveCpModelWithParameters(model_bytes, model_len, params_bytes, params_len,
                             &g_result, &g_result_len);
  return g_result_len;
}

EMSCRIPTEN_KEEPALIVE
void* get_result_ptr() {
  return g_result;
}

EMSCRIPTEN_KEEPALIVE
void free_result() {
  if (g_result) {
    free(g_result);
    g_result = nullptr;
    g_result_len = 0;
  }
}

}
