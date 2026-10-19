// The solution callback, and above all how many times it fires.
//
// A callback that fires once when it should fire fifteen times passes every
// assertion you would naturally write about the solutions it did deliver — the last
// one is still the answer, the objective still matches. So the count is asserted
// here, and the model is chosen to make a long chain of incumbents unavoidable.
//
// It is the weighted max-cut from ./models, whose chain of incumbents is long enough
// to count.
import { describe, it, expect, beforeAll } from 'vitest';
import {
  CpModel,
  CpSolver,
  CpSolverStatus,
  type CpSolverSolution,
} from '../../src/index.threaded.js';
import { maxCut, MAX_CUT_OPTIMUM as OPTIMUM } from './models.js';

describe('Solution callbacks', () => {
  let solver: CpSolver;

  beforeAll(async () => {
    solver = await CpSolver.create();
  });

  const collect = (numWorkers: number) => {
    const { model, side, edges } = maxCut();
    const seen: CpSolverSolution[] = [];
    const result = solver.solve(model, { numWorkers, onSolution: (s) => seen.push(s) });
    return { seen, result, side, edges };
  };

  it('reports a chain of improving solutions at one worker, live', () => {
    const { seen, result } = collect(1);

    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(seen.every((s) => s.live)).toBe(true);
    expect(result.status).toBe(CpSolverStatus.OPTIMAL);
    expect(result.objectiveValue).toBe(OPTIMUM);
    expect(seen[seen.length - 1].objectiveValue).toBe(OPTIMUM);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i].objectiveValue).toBeGreaterThan(seen[i - 1].objectiveValue);
    }
  });

  it('reports the same kind of chain at eight workers, recorded', () => {
    const { seen, result } = collect(8);

    expect(seen.length).toBeGreaterThanOrEqual(3);
    // Recorded, not live: the observer ran on subsolver threads that cannot enter JS,
    // so these were replayed in order once the search was over.
    expect(seen.every((s) => s.live)).toBe(false);
    expect(result.objectiveValue).toBe(OPTIMUM);
    expect(seen[seen.length - 1].objectiveValue).toBe(OPTIMUM);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i].objectiveValue).toBeGreaterThan(seen[i - 1].objectiveValue);
    }
    // The two searches are different searches and do not find the same solutions in
    // the same order, so only the shape of the sequence is asserted, never equality
    // with the one-worker run.
  });

  // Not "the objective the solver reported", which would be the solver agreeing with
  // itself: the score is recomputed here from the variable values the payload exposes.
  it('gives an incumbent values that add up to the objective it claims', () => {
    const { seen, edges } = collect(1);

    for (const solution of seen) {
      let scored = 0;
      for (const { ends, weight, cut } of edges) {
        const taken = solution.value(cut);
        expect([0, 1]).toContain(taken);
        // Summed over the cut variables, because that is what the objective sums. Not
        // over the partition: an edge whose ends differ is *permitted* to be cut, not
        // obliged to be, so an incumbent part-way up the climb can leave one uncut.
        if (taken) {
          const [a, b] = ends.map((end) => solution.value(end));
          expect(a).not.toBe(b);
        }
        scored += taken * weight;
      }
      expect(scored).toBe(solution.objectiveValue);
    }
  });

  // The response an observer receives is assembled inside the shared response manager
  // rather than by the code that fills in a final result, so neither of these carries
  // over from the non-callback path for free.
  it('stamps an incumbent with the wall time it was found at', () => {
    const { seen, result } = collect(1);

    expect(seen[0].wallTime).toBeGreaterThan(0);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i].wallTime).toBeGreaterThanOrEqual(seen[i - 1].wallTime);
    }
    expect(seen[seen.length - 1].wallTime).toBeLessThanOrEqual(result.wallTime);
  });

  it('reports a bound that brackets a maximised objective from above', () => {
    const { seen, result } = collect(1);

    // maximize negates the objective internally, so the sign of the bound is worth
    // pinning down: it has to be an upper bound on a maximisation, and it has to close
    // once optimality is proved.
    for (const s of seen) {
      expect(s.bestObjectiveBound).toBeGreaterThanOrEqual(s.objectiveValue);
    }
    expect(result.bestObjectiveBound).toBe(result.objectiveValue);
  });

  // With no objective there is nothing to improve on, so the observer fires once —
  // unless every solution is asked for, and then it fires for all of them. The count is
  // exact rather than a lower bound: three booleans summing to two is C(3,2) = 3, and
  // knowing the number is the whole point of a completeness claim.
  describe('enumerateAllSolutions', () => {
    const twoOfThree = () => {
      const model = new CpModel('two-of-three');
      const bits = [0, 1, 2].map((i) => model.newBoolVar(`b${i}`));
      // .toLinearExpr() because LinearExpr.plus will not take a bare IntVar — the
      // asymmetry tests/library.test.js pins in the consuming project.
      model.add(bits.reduce((acc, b) => acc.plus(b.toLinearExpr()), bits[0].times(0)).equals(2));
      return { model, bits };
    };

    it('reports every solution when asked', () => {
      const { model, bits } = twoOfThree();
      const seen: CpSolverSolution[] = [];
      solver.solve(model, {
        numWorkers: 1,
        enumerateAllSolutions: true,
        onSolution: (s) => seen.push(s),
      });

      expect(seen).toHaveLength(3);
      // All three, each distinct, each genuinely satisfying the constraint.
      const assignments = seen.map((s) => bits.map((b) => s.value(b)).join(''));
      expect(new Set(assignments).size).toBe(3);
      for (const s of seen) {
        expect(bits.reduce((n, b) => n + s.value(b), 0)).toBe(2);
      }
    });

    it('reports one solution when not asked', () => {
      const { model } = twoOfThree();
      const seen: CpSolverSolution[] = [];
      solver.solve(model, { numWorkers: 1, onSolution: (s) => seen.push(s) });

      expect(seen).toHaveLength(1);
    });
  });

  it('does not fire when there is nothing to report', () => {
    const model = new CpModel();
    const x = model.newIntVar(0, 10, 'x');
    model.add(x.ge(5));
    model.add(x.le(4));

    const seen: CpSolverSolution[] = [];
    const result = solver.solve(model, { numWorkers: 1, onSolution: (s) => seen.push(s) });

    expect(result.status).toBe(CpSolverStatus.INFEASIBLE);
    expect(seen).toHaveLength(0);
  });

  it('solves the same whether or not anyone is watching', () => {
    const watched = solver.solve(maxCut().model, { numWorkers: 1, onSolution: () => {} });
    const unwatched = solver.solve(maxCut().model, { numWorkers: 1 });

    expect(watched.objectiveValue).toBe(unwatched.objectiveValue);
    expect(watched.status).toBe(unwatched.status);
  });
});
