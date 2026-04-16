import { describe, it, expect, beforeAll } from 'vitest';
import { CpModel, CpSolver, CpSolverStatus } from '../../src/index.js';

describe('Scheduling Problem', () => {
  let solver: CpSolver;

  beforeAll(async () => {
    solver = await CpSolver.create();
  });

  it('schedules non-overlapping tasks to minimize makespan', () => {
    const model = new CpModel('scheduling');

    // 3 tasks with given durations, on a single machine
    const durations = [3, 5, 2];
    const horizon = durations.reduce((a, b) => a + b, 0); // worst case

    const starts = durations.map((_, i) =>
      model.newIntVar(0, horizon, `start_${i}`),
    );
    const ends = durations.map((_, i) =>
      model.newIntVar(0, horizon, `end_${i}`),
    );

    const intervals = durations.map((dur, i) =>
      model.newIntervalVar(starts[i], dur, ends[i], `task_${i}`),
    );

    // Tasks cannot overlap on the single machine
    model.addNoOverlap(intervals);

    // Minimize makespan (max of all end times)
    const makespan = model.newIntVar(0, horizon, 'makespan');
    for (const end of ends) {
      model.add(makespan.ge(end));
    }
    model.minimize(makespan);

    const result = solver.solve(model);

    expect(result.status).toBe(CpSolverStatus.OPTIMAL);
    // Optimal makespan = sum of durations = 10 (all sequential)
    expect(result.objectiveValue).toBe(10);

    // Verify no overlaps
    const taskStarts = starts.map((s) => result.value(s));
    const taskEnds = ends.map((e) => result.value(e));
    for (let i = 0; i < durations.length; i++) {
      for (let j = i + 1; j < durations.length; j++) {
        const overlap =
          taskStarts[i] < taskEnds[j] && taskStarts[j] < taskEnds[i];
        expect(overlap).toBe(false);
      }
    }
  });
});
