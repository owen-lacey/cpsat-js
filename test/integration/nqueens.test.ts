import { describe, it, expect, beforeAll } from 'vitest';
import { CpModel, CpSolver, CpSolverStatus } from '../../src/index.js';

describe('N-Queens Problem', () => {
  let solver: CpSolver;

  beforeAll(async () => {
    solver = await CpSolver.create();
  });

  it('solves 8-queens', () => {
    const n = 8;
    const model = new CpModel('nqueens');

    // queens[i] = column of queen in row i
    const queens = Array.from({ length: n }, (_, i) =>
      model.newIntVar(0, n - 1, `queen_${i}`),
    );

    // All queens in different columns
    model.addAllDifferent(queens);

    // All queens on different diagonals
    // queens[i] + i must all be different
    const diagUp = queens.map((q, i) => q.plus(i));
    model.addAllDifferent(diagUp);

    // queens[i] - i must all be different
    const diagDown = queens.map((q, i) => q.minus(i));
    model.addAllDifferent(diagDown);

    const result = solver.solve(model);

    expect(result.status).toBe(CpSolverStatus.OPTIMAL);

    // Verify solution: all columns different
    const cols = queens.map((q) => result.value(q));
    expect(new Set(cols).size).toBe(n);

    // Verify: no two queens on same diagonal
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        expect(Math.abs(cols[i] - cols[j])).not.toBe(j - i);
      }
    }
  });
});
