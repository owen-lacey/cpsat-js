import { describe, it, expect, beforeAll } from 'vitest';
import { CpModel, CpSolver, CpSolverStatus } from '../../src/index.js';

describe('TSP (Circuit Constraint)', () => {
  let solver: CpSolver;

  beforeAll(async () => {
    solver = await CpSolver.create();
  });

  it('solves a small TSP with 4 cities', () => {
    const model = new CpModel('tsp');

    // Distance matrix (symmetric)
    const dist = [
      [0, 10, 15, 20],
      [10, 0, 35, 25],
      [15, 35, 0, 30],
      [20, 25, 30, 0],
    ];
    const n = dist.length;

    // Arc variables and literals
    const arcs: [number, number, ReturnType<typeof model.newBoolVar>][] = [];
    const arcVars: ReturnType<typeof model.newBoolVar>[][] = Array.from(
      { length: n },
      () => [],
    );

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i !== j) {
          const arcVar = model.newBoolVar(`arc_${i}_${j}`);
          arcs.push([i, j, arcVar]);
          arcVars[i][j] = arcVar;
        }
      }
    }

    // Circuit constraint: arcs form a single Hamiltonian cycle
    model.addCircuit(arcs);

    // Minimize total distance
    const totalDist = arcs.reduce(
      (acc, [i, j, v]) => acc.plus(v.times(dist[i][j])),
      arcs[0][2].times(0), // start with zero expression
    );
    model.minimize(totalDist);

    const result = solver.solve(model);

    expect(result.status).toBe(CpSolverStatus.OPTIMAL);
    // Known optimal for this 4-city instance: 80
    // Route: 0→1→3→2→0 (10+25+30+15=80) or equivalent
    expect(result.objectiveValue).toBe(80);
  });
});
