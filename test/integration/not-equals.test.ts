import { describe, it, expect, beforeAll } from 'vitest';
import { CpModel, CpSolver, type CpSolverSolution } from '../../src/index.threaded.js';

describe('notEquals', () => {
  let solver: CpSolver;

  beforeAll(async () => {
    solver = await CpSolver.create();
  });

  const enumerate = <T>(model: CpModel, read: (s: CpSolverSolution) => T) => {
    const seen: T[] = [];
    solver.solve(model, {
      numWorkers: 1,
      enumerateAllSolutions: true,
      onSolution: (s) => seen.push(read(s)),
    });
    return seen;
  };

  it('excludes the value from an IntVar', () => {
    const model = new CpModel();
    const x = model.newIntVar(0, 2, 'x');
    model.add(x.notEquals(1));

    const seen = enumerate(model, (s) => s.value(x));
    expect(seen.sort()).toEqual([0, 2]);
  });

  it('excludes the value from a LinearExpr', () => {
    const model = new CpModel();
    const x = model.newIntVar(0, 2, 'x');
    model.add(x.plus(1).notEquals(2));

    const seen = enumerate(model, (s) => s.value(x));
    expect(seen.sort()).toEqual([0, 2]);
  });

  it('holds under onlyEnforceIf for reification', () => {
    const model = new CpModel();
    const x = model.newIntVar(0, 2, 'x');
    const b = model.newBoolVar('b');
    model.add(x.equals(1)).onlyEnforceIf(b);
    model.add(x.notEquals(1)).onlyEnforceIf(b.not());

    const seen = enumerate(model, (s) => `${s.value(x)}:${s.value(b)}`);
    expect(seen.sort()).toEqual(['0:0', '1:1', '2:0']);
  });
});
