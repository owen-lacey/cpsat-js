// Models shared between integration test files.
import { CpModel, type BoolVar } from '../../src/index.threaded.js';

/** A seeded generator, so a model built from it is a fixed model and not a random one. */
export const rand = (seed: number) => {
  let s = seed;
  return (n: number) => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s % n;
  };
};

/**
 * Weighted max-cut: split the nodes in two, and score every edge whose ends land on
 * opposite sides. Hard enough that CP-SAT has to climb to the answer rather than
 * deduce it: measured, 15 improving solutions at one worker and 12 at eight, both
 * proving MAX_CUT_OPTIMUM in well under a second. A knapsack — the obvious first
 * choice — is useless for this: CP-SAT cracks one in presolve.
 */
export const maxCut = () => {
  const nodes = 20;
  const next = rand(11);
  const model = new CpModel('max-cut');
  const side = Array.from({ length: nodes }, (_, i) => model.newBoolVar(`side_${i}`));
  const edges: { ends: [BoolVar, BoolVar]; weight: number; cut: BoolVar }[] = [];

  for (let i = 0; i < nodes; i++) {
    for (let d = 0; d < 3; d++) {
      const j = (i + 1 + next(nodes - 1)) % nodes;
      if (i === j) continue;
      const cut = model.newBoolVar(`cut_${i}_${d}`);
      // cut => the ends differ, both ways round.
      model.add(cut.le(side[i].plus(side[j])));
      model.add(cut.plus(side[i]).plus(side[j].toLinearExpr()).le(2));
      edges.push({ ends: [side[i], side[j]], weight: next(9) + 1, cut });
    }
  }

  model.maximize(
    edges.reduce((acc, e) => acc.plus(e.cut.times(e.weight)), side[0].times(0)),
  );
  return { model, side, edges };
};

export const MAX_CUT_OPTIMUM = 263;
