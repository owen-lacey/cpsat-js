# Build `ortools-wasm`: A WebAssembly Port of Google's CP-SAT Solver

## Objective
Create a npm-publishable WebAssembly port of Google OR-Tools' CP-SAT solver, following the same model as `highs-js` (https://github.com/lovasoa/highs-js). The result should be a clean, well-typed TypeScript/JavaScript package that runs CP-SAT in the browser and Node.js with no native dependencies.

## Reference Projects
- **highs-js** — https://github.com/lovasoa/highs-js — the gold standard for what we want to produce. Study its build pipeline, JS wrapper design, and npm packaging closely.
- **OR-Tools** — https://github.com/google/or-tools — source to compile. Focus on the CP-SAT module (`ortools/sat/`) rather than all of OR-Tools.
- **Emscripten** — https://emscripten.org — the WASM compilation toolchain.

## Known Challenges
- OR-Tools' build system is all-or-nothing by default (builds Python/Java wrappers, tests, examples). We need a targeted CMake build of just the CP-SAT module and its dependencies.
- Dependencies that must also compile to WASM: **abseil-cpp**, **protobuf**. These are the main blockers others have hit.
- A prior art Medium article (https://medium.com/swlh/a-suduko-solving-serverless-endpoint-using-webassembly-and-or-tools-df9f7bb10044) proved this is possible but didn't produce a reusable package.

## Build Pipeline
1. Use **Emscripten (emcc)** to compile OR-Tools' CP-SAT C++ source to `.wasm` + JS glue
2. Write a targeted `CMakeLists.txt` that builds only:
   - `ortools/sat/` (CP-SAT core)
   - `ortools/util/`
   - abseil and protobuf dependencies
3. Export a minimal C API surface via `EMSCRIPTEN_KEEPALIVE` that the JS wrapper calls into
4. Write a TypeScript wrapper that provides a fluent API

## Target JS/TS API
Mirror the Python CP-SAT API as closely as possible:

```typescript
import { CpModel, CpSolver } from 'ortools-wasm';

const model = new CpModel();
const x = model.newIntVar(0, 10, 'x');
const y = model.newIntVar(0, 10, 'y');
const z = model.newIntVar(0, 10, 'z');

model.add(x.plus(y).equals(z));
model.addAllDifferent([x, y, z]);
model.maximize(x.plus(y));

const solver = new CpSolver();
const status = await solver.solve(model);

if (status === 'OPTIMAL' || status === 'FEASIBLE') {
  console.log('x =', solver.value(x));
  console.log('y =', solver.value(y));
  console.log('z =', solver.value(z));
}
```

## Constraints to Support (MVP)
- `addAllDifferent`
- `addLinearConstraint` (e.g. x + y <= z)
- `addBoolOr` / `addBoolAnd`
- `addNoOverlap` (for scheduling)
- `addCircuit` (for routing/TSP)
- `minimize` / `maximize` objective

## Package Structure
```
ortools-wasm/
├── src/
│   ├── cpp/          # C++ entry point / exported API surface
│   └── ts/           # TypeScript wrapper
├── build/
│   └── ortools.wasm  # compiled output
├── dist/             # bundled JS + types
├── CMakeLists.txt    # targeted WASM build
├── package.json
└── README.md
```

## Deliverables
1. Working `CMakeLists.txt` that compiles CP-SAT + deps to WASM via Emscripten
2. Minimal C API surface (`cpsat_api.cpp`) exported to JS
3. TypeScript wrapper with full type definitions
4. A test suite covering the MVP constraints above
5. A README with install + usage instructions matching the highs-js style

## Success Criteria
- `npm install ortools-wasm` works
- The knapsack problem, N-queens, and a simple scheduling problem all solve correctly in a browser environment
- Bundle size is acceptable (target < 5MB gzipped)
- Works in both browser (via bundler) and Node.js