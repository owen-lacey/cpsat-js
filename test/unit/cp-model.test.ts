import { describe, it, expect } from 'vitest';
import { toBinary, fromBinary } from '@bufbuild/protobuf';
import { CpModel } from '../../src/model/cp-model.js';
import type { IntVar } from '../../src/model/int-var.js';
import {
  CpModelProtoSchema,
} from '../../src/generated/cp_model_pb.js';

describe('CpModel', () => {
  it('creates integer variables with correct domains', () => {
    const model = new CpModel();
    const x = model.newIntVar(0, 10, 'x');
    const y = model.newIntVar(-5, 5, 'y');

    const proto = model.toProto();
    expect(proto.variables).toHaveLength(2);
    expect(proto.variables[0].name).toBe('x');
    expect(proto.variables[0].domain).toEqual([0n, 10n]);
    expect(proto.variables[1].name).toBe('y');
    expect(proto.variables[1].domain).toEqual([-5n, 5n]);

    expect(x.index).toBe(0);
    expect(y.index).toBe(1);
  });

  it('creates boolean variables with domain [0, 1]', () => {
    const model = new CpModel();
    const b = model.newBoolVar('b');

    const proto = model.toProto();
    expect(proto.variables[0].domain).toEqual([0n, 1n]);
    expect(b.index).toBe(0);
  });

  it('creates constant variables', () => {
    const model = new CpModel();
    const c = model.newConstant(42);

    const proto = model.toProto();
    expect(proto.variables[0].domain).toEqual([42n, 42n]);
    expect(c.index).toBe(0);
  });

  it('adds linear constraints via bounded expressions', () => {
    const model = new CpModel();
    const x = model.newIntVar(0, 10, 'x');
    const y = model.newIntVar(0, 10, 'y');

    // x + y <= 15 → x + y - 15 <= 0
    model.add(x.plus(y).le(15));

    const proto = model.toProto();
    expect(proto.constraints).toHaveLength(1);
    expect(proto.constraints[0].constraint.case).toBe('linear');
  });

  it('adds equality constraints', () => {
    const model = new CpModel();
    const x = model.newIntVar(0, 10, 'x');
    const y = model.newIntVar(0, 10, 'y');

    model.add(x.equals(y));

    const proto = model.toProto();
    expect(proto.constraints).toHaveLength(1);
    const ct = proto.constraints[0].constraint;
    expect(ct.case).toBe('linear');
    if (ct.case === 'linear') {
      // domain should be [0, 0] for equality
      expect(ct.value.domain).toEqual([0n, 0n]);
    }
  });

  it('adds allDifferent constraints', () => {
    const model = new CpModel();
    const vars = Array.from({ length: 4 }, (_, i) =>
      model.newIntVar(0, 3, `v${i}`),
    );

    model.addAllDifferent(vars);

    const proto = model.toProto();
    expect(proto.constraints).toHaveLength(1);
    expect(proto.constraints[0].constraint.case).toBe('allDiff');
    if (proto.constraints[0].constraint.case === 'allDiff') {
      expect(proto.constraints[0].constraint.value.exprs).toHaveLength(4);
    }
  });

  it('adds boolOr constraints', () => {
    const model = new CpModel();
    const a = model.newBoolVar('a');
    const b = model.newBoolVar('b');

    model.addBoolOr([a, b]);

    const proto = model.toProto();
    expect(proto.constraints[0].constraint.case).toBe('boolOr');
    if (proto.constraints[0].constraint.case === 'boolOr') {
      expect(proto.constraints[0].constraint.value.literals).toEqual([0, 1]);
    }
  });

  it('adds boolAnd constraints', () => {
    const model = new CpModel();
    const a = model.newBoolVar('a');
    const b = model.newBoolVar('b');

    model.addBoolAnd([a, b]);

    const proto = model.toProto();
    expect(proto.constraints[0].constraint.case).toBe('boolAnd');
  });

  it('adds noOverlap constraints with intervals', () => {
    const model = new CpModel();
    const s1 = model.newIntVar(0, 10, 's1');
    const s2 = model.newIntVar(0, 10, 's2');

    const i1 = model.newIntervalVar(s1, 3, s1.plus(3), 'i1');
    const i2 = model.newIntervalVar(s2, 2, s2.plus(2), 'i2');

    model.addNoOverlap([i1, i2]);

    const proto = model.toProto();
    // 2 interval constraints + 1 noOverlap constraint
    expect(proto.constraints).toHaveLength(3);
    expect(proto.constraints[2].constraint.case).toBe('noOverlap');
  });

  it('adds circuit constraints', () => {
    const model = new CpModel();
    const arcs: [number, number, ReturnType<typeof model.newBoolVar>][] = [];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        if (i !== j) {
          arcs.push([i, j, model.newBoolVar(`arc_${i}_${j}`)]);
        }
      }
    }

    model.addCircuit(arcs);

    const proto = model.toProto();
    const circuitCt = proto.constraints.find(
      (c) => c.constraint.case === 'circuit',
    );
    expect(circuitCt).toBeDefined();
    if (circuitCt?.constraint.case === 'circuit') {
      expect(circuitCt.constraint.value.tails).toHaveLength(6);
      expect(circuitCt.constraint.value.heads).toHaveLength(6);
      expect(circuitCt.constraint.value.literals).toHaveLength(6);
    }
  });

  it('sets minimize objective', () => {
    const model = new CpModel();
    const x = model.newIntVar(0, 100, 'x');

    model.minimize(x);

    const proto = model.toProto();
    expect(proto.objective).toBeDefined();
    expect(proto.objective!.vars).toEqual([0]);
    expect(proto.objective!.coeffs).toEqual([1n]);
    expect(proto.objective!.scalingFactor).toBe(1.0);
  });

  it('sets maximize objective (negated internally)', () => {
    const model = new CpModel();
    const x = model.newIntVar(0, 100, 'x');

    model.maximize(x);

    const proto = model.toProto();
    expect(proto.objective).toBeDefined();
    expect(proto.objective!.vars).toEqual([0]);
    expect(proto.objective!.coeffs).toEqual([-1n]);
    expect(proto.objective!.scalingFactor).toBe(-1.0);
  });

  it('supports constraint enforcement literals', () => {
    const model = new CpModel();
    const x = model.newIntVar(0, 10, 'x');
    const b = model.newBoolVar('b');

    model.add(x.le(5)).onlyEnforceIf(b);

    const proto = model.toProto();
    expect(proto.constraints[0].enforcementLiteral).toEqual([1]);
  });

  it('carries hints into the proto as a partial assignment', () => {
    const model = new CpModel();
    const x = model.newIntVar(0, 10, 'x');
    const b = model.newBoolVar('b');
    model.newIntVar(0, 10, 'unhinted');

    model.addHint(x, 7);
    model.addHint(b, 1);

    const hint = model.toProto().solutionHint;
    expect(hint).toBeDefined();
    // Partial on purpose: the third variable is not named at all.
    expect(hint!.vars).toEqual([0, 1]);
    expect(hint!.values).toEqual([7n, 1n]);
  });

  it('leaves solutionHint unset when nothing is hinted', () => {
    const model = new CpModel();
    model.newIntVar(0, 10, 'x');

    expect(model.toProto().solutionHint).toBeUndefined();
  });

  // CpModelProto requires the hinted indices to be unique, so a second hint for one
  // variable has to replace the first rather than append beside it.
  it('replaces a variable’s hint instead of duplicating it', () => {
    const model = new CpModel();
    const x = model.newIntVar(0, 10, 'x');

    model.addHint(x, 3);
    model.addHint(x, 9);

    const hint = model.toProto().solutionHint;
    expect(hint!.vars).toEqual([0]);
    expect(hint!.values).toEqual([9n]);
  });

  it('clearHints leaves the proto as it was', () => {
    const model = new CpModel();
    const x = model.newIntVar(0, 10, 'x');

    model.addHint(x, 7);
    expect(model.toProto().solutionHint).toBeDefined();

    model.clearHints();
    expect(model.toProto().solutionHint).toBeUndefined();
  });

  it('adds multiplication constraints over affine expressions', () => {
    const model = new CpModel();
    const x = model.newIntVar(0, 10, 'x');
    const y = model.newIntVar(0, 100, 'y');

    model.addMultiplicationEquality(y, [x, x.plus(1)]);

    const ct = model.toProto().constraints[0].constraint;
    expect(ct.case).toBe('intProd');
    if (ct.case === 'intProd') {
      expect(ct.value.target?.vars).toEqual([1]);
      expect(ct.value.exprs).toHaveLength(2);
      expect(ct.value.exprs[1].offset).toBe(1n);
    }
  });

  it('adds division and modulo constraints with two operands', () => {
    const model = new CpModel();
    const x = model.newIntVar(0, 20, 'x');
    const q = model.newIntVar(0, 20, 'q');
    const r = model.newIntVar(0, 20, 'r');

    model.addDivisionEquality(q, x, 5);
    model.addModuloEquality(r, x, 5);

    const [div, mod] = model.toProto().constraints.map((c) => c.constraint);
    expect(div.case).toBe('intDiv');
    expect(mod.case).toBe('intMod');
    if (div.case === 'intDiv' && mod.case === 'intMod') {
      expect(div.value.exprs[1].offset).toBe(5n);
      expect(mod.value.exprs[1].offset).toBe(5n);
    }
  });

  it.each([
    ['addMultiplicationEquality', (m: CpModel, a: IntVar, b: IntVar) => m.addMultiplicationEquality(a, [a.plus(b), b])],
    ['addDivisionEquality', (m: CpModel, a: IntVar, b: IntVar) => m.addDivisionEquality(a.plus(b), a, 2)],
    ['addModuloEquality', (m: CpModel, a: IntVar, b: IntVar) => m.addModuloEquality(a, a.plus(b), 3)],
  ])('%s throws on an expression with more than one variable', (method, build) => {
    const model = new CpModel();
    const a = model.newIntVar(0, 10, 'a');
    const b = model.newIntVar(1, 10, 'b');

    expect(() => build(model, a, b)).toThrow(`${method}: each expression may use at most one variable`);
  });

  it('adds max constraints over general linear expressions', () => {
    const model = new CpModel();
    const x = model.newIntVar(0, 10, 'x');
    const y = model.newIntVar(0, 10, 'y');
    const m = model.newIntVar(0, 20, 'm');

    model.addMaxEquality(m, [x.plus(y), x, 3]);

    const ct = model.toProto().constraints[0].constraint;
    expect(ct.case).toBe('linMax');
    if (ct.case === 'linMax') {
      expect(ct.value.exprs[0].vars).toEqual([0, 1]);
      expect(ct.value.exprs[2].offset).toBe(3n);
    }
  });

  it('encodes min as max over negated expressions', () => {
    const model = new CpModel();
    const x = model.newIntVar(0, 10, 'x');
    const m = model.newIntVar(0, 10, 'm');

    model.addMinEquality(m, [x, 4]);

    const ct = model.toProto().constraints[0].constraint;
    expect(ct.case).toBe('linMax');
    if (ct.case === 'linMax') {
      expect(ct.value.target?.coeffs).toEqual([-1n]);
      expect(ct.value.exprs[0].coeffs).toEqual([-1n]);
      expect(ct.value.exprs[1].offset).toBe(-4n);
    }
  });

  it('serializes to and from binary protobuf', () => {
    const model = new CpModel('test-model');
    const x = model.newIntVar(0, 10, 'x');
    const y = model.newIntVar(0, 10, 'y');
    model.add(x.plus(y).le(15));
    model.maximize(x.plus(y));

    const proto = model.toProto();
    const bytes = toBinary(CpModelProtoSchema, proto);
    expect(bytes.length).toBeGreaterThan(0);

    const decoded = fromBinary(CpModelProtoSchema, bytes);
    expect(decoded.name).toBe('test-model');
    expect(decoded.variables).toHaveLength(2);
    expect(decoded.constraints).toHaveLength(1);
    expect(decoded.objective).toBeDefined();
  });
});
