import { create, toBinary, fromBinary } from '@bufbuild/protobuf';
import {
  CpModelProtoSchema,
  CpSolverResponseSchema,
  CpSolverStatus,
  type CpSolverResponse,
} from '../generated/cp_model_pb.js';
import {
  SatParametersSchema,
} from '../generated/sat_parameters_pb.js';
import type { CpModel } from '../model/cp-model.js';
import type { IntVar } from '../model/int-var.js';

export { CpSolverStatus };

export interface CpSolverOptions {
  /** Custom path resolver for the WASM binary */
  locateFile?: (path: string) => string;
}

interface CpSatModule {
  _solve(
    modelPtr: number,
    modelLen: number,
    paramsPtr: number,
    paramsLen: number,
    observe: number,
  ): number;
  _get_result_ptr(): number;
  _free_result(): void;
  _solution_count(): number;
  _solution_ptr(index: number): number;
  _solution_len(index: number): number;
  _malloc(size: number): number;
  _free(ptr: number): void;
  HEAPU8: Uint8Array;
  /** Where the C++ observer reaches for a live callback. Set only during a solve. */
  __cpsatOnSolution?: (bytes: Uint8Array) => void;
}

export type WasmFactory = (options?: Record<string, unknown>) => Promise<CpSatModule>;

/**
 * Loads the Emscripten glue for one build variant.
 *
 * Supplied by the package entry point rather than resolved here, so that each entry
 * references exactly one literal WASM path. A bundler following the "browser"
 * condition then only ever sees the portable binary, and never emits the threaded
 * one as an asset.
 */
export type GlueLoader = (locateFile?: (path: string) => string) => Promise<WasmFactory>;

let glueLoader: GlueLoader | undefined;
let glueIsThreaded = false;

/** @internal — called by the package entry point (index.threaded / index.portable). */
export function setGlueLoader(loader: GlueLoader, threaded: boolean): void {
  glueLoader = loader;
  glueIsThreaded = threaded;
}

export interface SolverParams {
  maxTimeInSeconds?: number;
  /**
   * Limit on CP-SAT's internal work counter, in "deterministic seconds".
   *
   * Unlike `maxTimeInSeconds` this does not depend on the machine: a solve stopped by it
   * stops at the same point everywhere, so it can be replayed exactly from its inputs.
   * That holds only at `numWorkers: 1` — parallel workers race — and only when
   * `maxTimeInSeconds` is unset or generous enough never to fire first.
   */
  maxDeterministicTime?: number;
  /**
   * Seed for CP-SAT's randomised choices. CP-SAT's default is 1.
   *
   * Only the parallel portfolio draws on it: at `numWorkers: 1` the default search
   * makes no random choices, so every seed gives the same answer there.
   */
  randomSeed?: number;
  /**
   * Number of parallel subsolvers. Defaults to 8.
   *
   * This is not a simple speed/resource dial: `num_workers` selects which subsolver
   * portfolio CP-SAT runs. Below 6 it runs a degraded subset — 2 and 4 are slower
   * than 1 on real models. Use 1 or >= 6, never in between.
   */
  numWorkers?: number;
  /**
   * Report every solution rather than stopping at the first.
   *
   * **Only meaningful on a model with no objective.** CP-SAT's own wording is "whether
   * we enumerate all solutions of a problem without objective"; with an objective the
   * search reports improving solutions instead, and this does nothing for you.
   *
   * Combined with `onSolution` this is what streams a complete solution set as the
   * search finds it. The solutions arrive in whatever order the search happens on —
   * there is no objective, so there is no ordering — and OR-Tools warns against reading
   * anything into it beyond completeness.
   *
   * Setting this also disables the presolve reductions that can remove feasible
   * solutions, which is the same effect as `keep_all_feasible_solutions_in_presolve`.
   */
  enumerateAllSolutions?: boolean;
  /**
   * Called for each improving solution the search finds.
   *
   * Purely observational: the return value is ignored and nothing here can steer or
   * stop the search. Use `maxTimeInSeconds` to bound it.
   *
   * **When the calls arrive depends on `numWorkers`.** At 1 worker CP-SAT solves on
   * the calling thread, so these are live — they interleave with the search, and
   * `solve()` has not returned yet. Above 1 worker the search runs on threads that
   * cannot enter JS, so incumbents are recorded and replayed in order just before
   * `solve()` returns. `live` on each solution says which happened. The sequence and
   * its contents are the same either way; only the timing differs.
   *
   * At 1 worker the handler runs inside the solver, holding a lock: keep it quick,
   * and do not call back into the solver from it. Post the solution somewhere and
   * return.
   */
  onSolution?: (solution: CpSolverSolution) => void;
}

export interface CpSolverResult {
  status: CpSolverStatus;
  objectiveValue: number;
  bestObjectiveBound: number;
  wallTime: number;
  /** Get the value of a variable in the solution */
  value(variable: IntVar): number;
  /** Raw response proto */
  response: CpSolverResponse;
}

/**
 * One improving solution seen during the search.
 *
 * The same shape as a final result — including `value()` — so an incumbent and an
 * answer can be read by the same code.
 */
export interface CpSolverSolution extends CpSolverResult {
  /** Delivered mid-solve (1 worker), or replayed just before solve() returned. */
  live: boolean;
}

/** Build the caller-facing view of a response. Shared by results and incumbents. */
function readResponse(response: CpSolverResponse): CpSolverResult {
  return {
    status: response.status,
    objectiveValue: response.objectiveValue,
    bestObjectiveBound: response.bestObjectiveBound,
    wallTime: response.wallTime,
    value(variable: IntVar): number {
      return Number(response.solution[variable.index]);
    },
    response,
  };
}

/**
 * Loads the WASM module and solves CP-SAT models.
 *
 * Usage:
 *   const solver = await CpSolver.create();
 *   const result = solver.solve(model);
 */
export class CpSolver {
  private module: CpSatModule;

  private constructor(module: CpSatModule) {
    this.module = module;
  }

  static async create(options?: CpSolverOptions): Promise<CpSolver> {
    if (!glueLoader) {
      throw new Error(
        "No WASM build was registered. Import the package entry point ('cpsat-js', " +
          "'cpsat-js/threaded' or 'cpsat-js/portable') rather than a deep internal path.",
      );
    }
    // The glue — and therefore the 6MB WASM — is only loaded here, on first create().
    const createModule = await glueLoader(options?.locateFile);
    const module = await createModule();
    return new CpSolver(module);
  }

  solve(model: CpModel, params?: SolverParams): CpSolverResult {
    const modelProto = model.toProto();
    const modelBytes = toBinary(CpModelProtoSchema, modelProto);

    const satParams = create(SatParametersSchema, {});
    // CP-SAT's speed comes from its parallel subsolver portfolio, which only engages
    // at >= 6 workers; 2 and 4 are measurably SLOWER than 1. The threaded WASM is
    // built with a pre-spawned pthread pool, so 8 is both safe and the right default.
    satParams.numWorkers = 8;
    if (params?.maxTimeInSeconds !== undefined) {
      satParams.maxTimeInSeconds = params.maxTimeInSeconds;
    }
    if (params?.maxDeterministicTime !== undefined) {
      satParams.maxDeterministicTime = params.maxDeterministicTime;
    }
    if (params?.randomSeed !== undefined) {
      satParams.randomSeed = params.randomSeed;
    }
    if (params?.numWorkers !== undefined) {
      satParams.numWorkers = params.numWorkers;
    }
    if (params?.enumerateAllSolutions !== undefined) {
      satParams.enumerateAllSolutions = params.enumerateAllSolutions;
    }
    // The portable build has no threads. Clamp to 1 rather than to some lower count:
    // anything in 2..5 selects a degraded portfolio and is slower than a single worker.
    if (!glueIsThreaded) {
      satParams.numWorkers = 1;
    }
    const paramsBytes = toBinary(SatParametersSchema, satParams);

    // Allocate WASM heap memory for model
    const modelPtr = this.module._malloc(modelBytes.length);
    this.module.HEAPU8.set(modelBytes, modelPtr);

    // Allocate WASM heap memory for params
    const paramsPtr = this.module._malloc(paramsBytes.length);
    this.module.HEAPU8.set(paramsBytes, paramsPtr);

    const onSolution = params?.onSolution;
    if (onSolution) {
      this.module.__cpsatOnSolution = (bytes) => {
        onSolution({ ...readResponse(fromBinary(CpSolverResponseSchema, bytes)), live: true });
      };
    }

    let resultLen: number;
    try {
      resultLen = this.module._solve(
        modelPtr,
        modelBytes.length,
        paramsPtr,
        paramsBytes.length,
        onSolution ? 1 : 0,
      );
    } finally {
      this.module._free(modelPtr);
      this.module._free(paramsPtr);
      delete this.module.__cpsatOnSolution;
    }

    // Incumbents the observer could only record, because it ran on a thread that
    // cannot enter JS. Drained unconditionally: a live solve recorded nothing, so the
    // count is zero and this does nothing. That way the 1-vs-many rule lives in one
    // place — the C++ observer — and is never restated here to drift out of step.
    if (onSolution) {
      const recorded = this.module._solution_count();
      for (let i = 0; i < recorded; i++) {
        const ptr = this.module._solution_ptr(i);
        const len = this.module._solution_len(i);
        // Re-read HEAPU8 each time: growing the heap replaces the buffer.
        const bytes = this.module.HEAPU8.slice(ptr, ptr + len);
        onSolution({ ...readResponse(fromBinary(CpSolverResponseSchema, bytes)), live: false });
      }
    }

    // Read result from WASM memory
    const resultPtr = this.module._get_result_ptr();
    const resultBytes = new Uint8Array(
      this.module.HEAPU8.buffer,
      resultPtr,
      resultLen,
    );
    // Copy before freeing
    const resultCopy = new Uint8Array(resultBytes);
    this.module._free_result();

    const response = fromBinary(CpSolverResponseSchema, resultCopy);

    return {
      status: response.status,
      objectiveValue: response.objectiveValue,
      bestObjectiveBound: response.bestObjectiveBound,
      wallTime: response.wallTime,
      value(variable: IntVar): number {
        return Number(response.solution[variable.index]);
      },
      response,
    };
  }
}

/**
 * Shared plumbing for the per-variant glue loaders. Each caller passes its own
 * statically-analysable import, so only that variant's WASM is ever emitted.
 */
export function makeGlueLoader(
  importGlue: () => Promise<{ default?: unknown }>,
  wasmUrl: () => string,
): GlueLoader {
  return async (locateFile) => {
    const glue = await importGlue();
    const factory = glue.default as WasmFactory | undefined;
    if (typeof factory !== 'function') {
      throw new Error('cpsat glue did not export a factory function');
    }
    const url = wasmUrl();
    const resolvedLocate =
      locateFile ?? ((path: string) => (path.endsWith('.wasm') ? url : path));
    return (options) => factory({ ...options, locateFile: resolvedLocate });
  };
}
