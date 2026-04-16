import { describe, it, expect, beforeAll } from 'vitest';
import { CpModel, CpSolver, CpSolverStatus } from '../../src/index.js';

describe('Knapsack Problem', () => {
  let solver: CpSolver;

  beforeAll(async () => {
    solver = await CpSolver.create();
  });

  it('solves a simple knapsack', () => {
    const model = new CpModel('knapsack');

    // Items: [value, weight]
    const items = [
      [60, 10],
      [100, 20],
      [120, 30],
    ];
    const capacity = 50;

    // Binary decision variables: take item or not
    const take = items.map((_, i) => model.newBoolVar(`take_${i}`));

    // Weight constraint: sum(weight[i] * take[i]) <= capacity
    const weightExpr = take.reduce(
      (acc, t, i) => acc.plus(t.times(items[i][1])),
      take[0].times(0), // start with zero expression
    );
    model.add(weightExpr.le(capacity));

    // Maximize total value
    const valueExpr = take.reduce(
      (acc, t, i) => acc.plus(t.times(items[i][0])),
      take[0].times(0),
    );
    model.maximize(valueExpr);

    const result = solver.solve(model);

    expect(result.status).toBe(CpSolverStatus.OPTIMAL);
    // Optimal: take items 1 and 2 (100 + 120 = 220, weight 20 + 30 = 50)
    expect(result.objectiveValue).toBe(220);
    expect(result.value(take[0])).toBe(0);
    expect(result.value(take[1])).toBe(1);
    expect(result.value(take[2])).toBe(1);
  });
});
