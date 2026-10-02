import { describe, it, expect } from 'vitest';
import { CpModel } from '../../src/model/cp-model.js';
import {
  create, toBinary, fromBinary,
  CpModelProtoSchema, CpSolverResponseSchema, SatParametersSchema,
} from '../../src/proto.js';

describe('cpsat-js/proto', () => {
  it('round-trips a model through its bytes', () => {
    const model = new CpModel();
    const x = model.newIntVar(0, 10, 'x');
    const y = model.newBoolVar('y');
    model.add(x.plus(y).le(5));
    model.maximize(x);

    const bytes = toBinary(CpModelProtoSchema, model.toProto());
    const back = fromBinary(CpModelProtoSchema, bytes);
    expect(back.variables.map(v => v.name)).toEqual(['x', 'y']);
    expect(back.constraints).toHaveLength(1);
    expect(back.objective).toBeDefined();
  });

  it('encodes parameters and decodes a response', () => {
    const params = create(SatParametersSchema, { numWorkers: 8, maxTimeInSeconds: 5 });
    expect(fromBinary(SatParametersSchema, toBinary(SatParametersSchema, params)).numWorkers).toBe(8);

    const response = create(CpSolverResponseSchema, { solution: [3n, 1n], objectiveValue: 3 });
    const back = fromBinary(CpSolverResponseSchema, toBinary(CpSolverResponseSchema, response));
    expect(back.solution).toEqual([3n, 1n]);
    expect(back.objectiveValue).toBe(3);
  });
});
