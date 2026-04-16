import { create } from '@bufbuild/protobuf';
import {
  type CpModelProto,
  CpModelProtoSchema,
  type ConstraintProto,
  ConstraintProtoSchema,
  IntegerVariableProtoSchema,
  AllDifferentConstraintProtoSchema,
  BoolArgumentProtoSchema,
  NoOverlapConstraintProtoSchema,
  CircuitConstraintProtoSchema,
  LinearConstraintProtoSchema,
  IntervalConstraintProtoSchema,
  CpObjectiveProtoSchema,
} from '../generated/cp_model_pb.js';
import { IntVar, BoolVar, type LinearExprLike } from './int-var.js';
import { BoundedLinearExpression, toLinearExpr } from './linear-expr.js';
import { IntervalVar } from './interval-var.js';
import { Constraint } from './constraint.js';

/**
 * Builder for a CP-SAT model. Mirrors the Python CpModel API.
 *
 * Usage:
 *   const model = new CpModel();
 *   const x = model.newIntVar(0, 10, 'x');
 *   model.maximize(x);
 */
export class CpModel {
  private readonly proto: CpModelProto;

  constructor(name?: string) {
    this.proto = create(CpModelProtoSchema, { name: name ?? '' });
  }

  // ── Variable creation ──

  newIntVar(lb: number | bigint, ub: number | bigint, name: string): IntVar {
    const index = this.proto.variables.length;
    this.proto.variables.push(
      create(IntegerVariableProtoSchema, {
        name,
        domain: [BigInt(lb), BigInt(ub)],
      }),
    );
    return new IntVar(index, name);
  }

  newBoolVar(name: string): BoolVar {
    const index = this.proto.variables.length;
    this.proto.variables.push(
      create(IntegerVariableProtoSchema, {
        name,
        domain: [0n, 1n],
      }),
    );
    return new BoolVar(index, name);
  }

  newConstant(value: number | bigint): IntVar {
    const v = BigInt(value);
    const name = `const_${v}`;
    const index = this.proto.variables.length;
    this.proto.variables.push(
      create(IntegerVariableProtoSchema, {
        name,
        domain: [v, v],
      }),
    );
    return new IntVar(index, name);
  }

  // ── Interval creation ──

  newIntervalVar(
    start: LinearExprLike,
    size: LinearExprLike,
    end: LinearExprLike,
    name: string,
  ): IntervalVar {
    const ct = this.addConstraintProto();
    ct.name = name;
    ct.constraint = {
      case: 'interval',
      value: create(IntervalConstraintProtoSchema, {
        start: toLinearExpr(start).toProto(),
        size: toLinearExpr(size).toProto(),
        end: toLinearExpr(end).toProto(),
      }),
    };
    return new IntervalVar(this.proto.constraints.length - 1, name);
  }

  // ── Constraints ──

  /** Add a bounded linear constraint: lb <= expr <= ub */
  add(bounded: BoundedLinearExpression): Constraint {
    const ct = this.addConstraintProto();
    const vars: number[] = [];
    const coeffs: bigint[] = [];
    for (const [varIdx, coeff] of bounded.expr.terms) {
      vars.push(varIdx);
      coeffs.push(coeff);
    }
    ct.constraint = {
      case: 'linear',
      value: create(LinearConstraintProtoSchema, {
        vars,
        coeffs,
        domain: [bounded.lb - bounded.expr.offset, bounded.ub - bounded.expr.offset],
      }),
    };
    return new Constraint(ct);
  }

  addLinearConstraint(expr: LinearExprLike, lb: number | bigint, ub: number | bigint): Constraint {
    const linearExpr = toLinearExpr(expr);
    return this.add(new BoundedLinearExpression(linearExpr, BigInt(lb), BigInt(ub)));
  }

  addAllDifferent(exprs: LinearExprLike[]): Constraint {
    const ct = this.addConstraintProto();
    ct.constraint = {
      case: 'allDiff',
      value: create(AllDifferentConstraintProtoSchema, {
        exprs: exprs.map((e) => toLinearExpr(e).toProto()),
      }),
    };
    return new Constraint(ct);
  }

  addBoolOr(literals: (BoolVar | IntVar | number)[]): Constraint {
    const ct = this.addConstraintProto();
    ct.constraint = {
      case: 'boolOr',
      value: create(BoolArgumentProtoSchema, {
        literals: literals.map((lit) => (typeof lit === 'number' ? lit : lit.index)),
      }),
    };
    return new Constraint(ct);
  }

  addBoolAnd(literals: (BoolVar | IntVar | number)[]): Constraint {
    const ct = this.addConstraintProto();
    ct.constraint = {
      case: 'boolAnd',
      value: create(BoolArgumentProtoSchema, {
        literals: literals.map((lit) => (typeof lit === 'number' ? lit : lit.index)),
      }),
    };
    return new Constraint(ct);
  }

  addNoOverlap(intervals: IntervalVar[]): Constraint {
    const ct = this.addConstraintProto();
    ct.constraint = {
      case: 'noOverlap',
      value: create(NoOverlapConstraintProtoSchema, {
        intervals: intervals.map((iv) => iv.constraintIndex),
      }),
    };
    return new Constraint(ct);
  }

  addCircuit(arcs: [number, number, BoolVar | IntVar | number][]): Constraint {
    const tails: number[] = [];
    const heads: number[] = [];
    const literals: number[] = [];
    for (const [tail, head, lit] of arcs) {
      tails.push(tail);
      heads.push(head);
      literals.push(typeof lit === 'number' ? lit : lit.index);
    }
    const ct = this.addConstraintProto();
    ct.constraint = {
      case: 'circuit',
      value: create(CircuitConstraintProtoSchema, { tails, heads, literals }),
    };
    return new Constraint(ct);
  }

  // ── Objective ──

  minimize(expr: LinearExprLike): void {
    this.setObjective(expr, false);
  }

  maximize(expr: LinearExprLike): void {
    this.setObjective(expr, true);
  }

  // ── Serialization ──

  toProto(): CpModelProto {
    return this.proto;
  }

  // ── Internal ──

  private addConstraintProto(): ConstraintProto {
    const ct = create(ConstraintProtoSchema, {});
    this.proto.constraints.push(ct);
    return ct;
  }

  private setObjective(expr: LinearExprLike, maximize: boolean): void {
    const linearExpr = toLinearExpr(expr);
    const vars: number[] = [];
    const coeffs: bigint[] = [];
    for (const [varIdx, coeff] of linearExpr.terms) {
      vars.push(varIdx);
      // For maximization, negate coefficients (CP-SAT always minimizes)
      coeffs.push(maximize ? -coeff : coeff);
    }
    this.proto.objective = create(CpObjectiveProtoSchema, {
      vars,
      coeffs,
      offset: maximize ? -Number(linearExpr.offset) : Number(linearExpr.offset),
      scalingFactor: maximize ? -1.0 : 1.0,
    });
  }
}
