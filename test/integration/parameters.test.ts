// Parameters that make a solve reproducible: a machine-independent work limit, and the
// seed CP-SAT draws its randomised choices from.
import { describe, it, expect, beforeAll } from 'vitest';
import { CpModel, CpSolver, CpSolverStatus } from '../../src/index.threaded.js';
import { maxCut } from './models.js';

describe('Reproducibility parameters', () => {
  let solver: CpSolver;

  beforeAll(async () => {
    solver = await CpSolver.create();
  });

  // Measured: max-cut takes ~0.2 deterministic seconds to prove optimality at one
  // worker, so 0.01 stops it part-way up the climb with a feasible incumbent.
  describe('maxDeterministicTime', () => {
    const limited = () =>
      solver.solve(maxCut().model, { numWorkers: 1, maxDeterministicTime: 0.01 });

    it('stops the search at the work limit', () => {
      const result = limited();

      expect(result.status).toBe(CpSolverStatus.FEASIBLE);
      expect(result.response.deterministicTime).toBeGreaterThan(0);
      expect(result.response.deterministicTime).toBeLessThan(0.02);
    });

    it('stops at the same point every time', () => {
      const a = limited();
      const b = limited();

      expect(b.objectiveValue).toBe(a.objectiveValue);
      expect(b.response.solution).toEqual(a.response.solution);
      expect(b.response.deterministicTime).toBe(a.response.deterministicTime);
    });
  });

  // Only the parallel portfolio draws on the seed: at one worker the default search
  // makes no random choices, and every seed gives the same answer. 30-queens has many
  // solutions, and at eight workers each seed was measured to return its own one,
  // identically across repeated runs — so a difference here is the seed, not a race.
  describe('randomSeed', () => {
    const queens = (seed: number) => {
      const n = 30;
      const model = new CpModel('nqueens');
      const q = Array.from({ length: n }, (_, i) => model.newIntVar(0, n - 1, `q${i}`));
      model.addAllDifferent(q);
      model.addAllDifferent(q.map((x, i) => x.plus(i)));
      model.addAllDifferent(q.map((x, i) => x.minus(i)));
      const result = solver.solve(model, { numWorkers: 8, randomSeed: seed });
      expect(result.status).toBe(CpSolverStatus.OPTIMAL);
      return q.map((x) => result.value(x));
    };

    it('reaches the solver', () => {
      expect(queens(2)).not.toEqual(queens(1));
    });
  });
});
