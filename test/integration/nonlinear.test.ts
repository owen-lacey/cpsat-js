import { describe, it, expect, beforeAll } from 'vitest';
import { CpModel, CpSolver, CpSolverStatus } from '../../src/index.threaded.js';

describe('Non-linear constraints', () => {
  let solver: CpSolver;

  beforeAll(async () => {
    solver = await CpSolver.create();
  });

  it('solves a product and a sum together', () => {
    const model = new CpModel('product');
    const x = model.newIntVar(0, 10, 'x');
    const y = model.newIntVar(0, 10, 'y');
    const xy = model.newIntVar(0, 100, 'xy');

    model.addMultiplicationEquality(xy, [x, y]);
    model.add(xy.equals(24));
    model.add(x.plus(y).equals(10));
    model.add(x.le(y));

    const result = solver.solve(model);

    expect(result.status).toBe(CpSolverStatus.OPTIMAL);
    expect(result.value(x)).toBe(4);
    expect(result.value(y)).toBe(6);
  });

  it('minimizes a squared distance', () => {
    const model = new CpModel('square');
    const x = model.newIntVar(-10, 10, 'x');
    const sq = model.newIntVar(0, 100, 'sq');

    // (x - 3)^2, with x - 3 an affine expression
    model.addMultiplicationEquality(sq, [x.minus(3), x.minus(3)]);
    model.minimize(sq);

    const result = solver.solve(model);

    expect(result.status).toBe(CpSolverStatus.OPTIMAL);
    expect(result.value(x)).toBe(3);
    expect(result.objectiveValue).toBe(0);
  });

  it('computes division rounded towards zero and modulo', () => {
    const model = new CpModel('divmod');
    const x = model.newIntVar(-17, -17, 'x');
    const q = model.newIntVar(-20, 20, 'q');
    const r = model.newIntVar(-20, 20, 'r');

    model.addDivisionEquality(q, x, 5);
    model.addModuloEquality(r, x, 5);

    const result = solver.solve(model);

    expect(result.status).toBe(CpSolverStatus.OPTIMAL);
    expect(result.value(q)).toBe(-3);
    expect(result.value(r)).toBe(-2);
  });

  it('computes max and min', () => {
    const model = new CpModel('maxmin');
    const vals = [3, 7, 5].map((v, i) => model.newIntVar(v, v, `v${i}`));
    const hi = model.newIntVar(0, 10, 'hi');
    const lo = model.newIntVar(0, 10, 'lo');

    model.addMaxEquality(hi, vals);
    model.addMinEquality(lo, vals);

    const result = solver.solve(model);

    expect(result.status).toBe(CpSolverStatus.OPTIMAL);
    expect(result.value(hi)).toBe(7);
    expect(result.value(lo)).toBe(3);
  });
});
