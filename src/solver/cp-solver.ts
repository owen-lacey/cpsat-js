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

export interface SolverParams {
  maxTimeInSeconds?: number;
  numWorkers?: number;
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

interface CpSatModule {
  _solve(modelPtr: number, modelLen: number, paramsPtr: number, paramsLen: number): number;
  _get_result_ptr(): number;
  _free_result(): void;
  _malloc(size: number): number;
  _free(ptr: number): void;
  HEAPU8: Uint8Array;
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
    // Dynamic import of the Emscripten-generated JS glue
    const createModule = await loadWasmFactory(options?.locateFile);
    const module = await createModule() as CpSatModule;
    return new CpSolver(module);
  }

  solve(model: CpModel, params?: SolverParams): CpSolverResult {
    const modelProto = model.toProto();
    const modelBytes = toBinary(CpModelProtoSchema, modelProto);

    const satParams = create(SatParametersSchema, {});
    // Force single worker for WASM (no threading support in MVP)
    satParams.numWorkers = 1;
    if (params?.maxTimeInSeconds !== undefined) {
      satParams.maxTimeInSeconds = params.maxTimeInSeconds;
    }
    if (params?.numWorkers !== undefined) {
      satParams.numWorkers = params.numWorkers;
    }
    const paramsBytes = toBinary(SatParametersSchema, satParams);

    // Allocate WASM heap memory for model
    const modelPtr = this.module._malloc(modelBytes.length);
    this.module.HEAPU8.set(modelBytes, modelPtr);

    // Allocate WASM heap memory for params
    const paramsPtr = this.module._malloc(paramsBytes.length);
    this.module.HEAPU8.set(paramsBytes, paramsPtr);

    let resultLen: number;
    try {
      resultLen = this.module._solve(modelPtr, modelBytes.length, paramsPtr, paramsBytes.length);
    } finally {
      this.module._free(modelPtr);
      this.module._free(paramsPtr);
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

async function loadWasmFactory(
  locateFile?: (path: string) => string,
): Promise<(options?: Record<string, unknown>) => Promise<CpSatModule>> {
  try {
    // Emscripten outputs CommonJS; use createRequire in ESM context
    const { createRequire } = await import('node:module');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const require = createRequire(import.meta.url);
    const factory = require(join(__dirname, '..', '..', 'build', 'cpsat.cjs'));
    if (typeof factory !== 'function') {
      throw new Error('WASM module did not export a factory function');
    }
    if (locateFile) {
      return () => factory({ locateFile });
    }
    return factory;
  } catch (err) {
    throw new Error(
      'Failed to load cpsat.wasm. Ensure the WASM build has been completed. ' +
      `Run \`npm run build:wasm\` to compile the WASM binary. (${err})`,
    );
  }
}
