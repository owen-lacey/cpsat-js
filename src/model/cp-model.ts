import { create } from '@bufbuild/protobuf';
import {
  type CpModelProto,
  CpModelProtoSchema,
  type ConstraintProto,
  ConstraintProtoSchema,
  type LinearExpressionProto,
  LinearArgumentProtoSchema,
  IntegerVariableProtoSchema,
  AllDifferentConstraintProtoSchema,
  BoolArgumentProtoSchema,
  NoOverlapConstraintProtoSchema,
  CircuitConstraintProtoSchema,
  LinearConstraintProtoSchema,
  IntervalConstraintProtoSchema,
  CpObjectiveProtoSchema,
  PartialVariableAssignmentSchema,
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

  /**
   * Hinted values, keyed by variable index.
   *
   * A Map rather than the proto's two parallel arrays because CpModelProto requires
   * the hinted indices to be unique. Keyed this way, hinting one variable twice
   * cannot be expressed, so it cannot produce an invalid model.
   */
  private readonly hints = new Map<number, bigint>();

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

  /** target == exprs[0] * exprs[1] * ... — each expression may use at most one variable */
  addMultiplicationEquality(target: LinearExprLike, exprs: LinearExprLike[]): Constraint {
    const method = 'addMultiplicationEquality';
    const ct = this.addConstraintProto();
    ct.constraint = {
      case: 'intProd',
      value: create(LinearArgumentProtoSchema, {
        target: toAffineProto(method, target),
        exprs: exprs.map((e) => toAffineProto(method, e)),
      }),
    };
    return new Constraint(ct);
  }

  /** target == num / denom, rounded towards zero — each expression may use at most one variable */
  addDivisionEquality(target: LinearExprLike, num: LinearExprLike, denom: LinearExprLike): Constraint {
    const method = 'addDivisionEquality';
    const ct = this.addConstraintProto();
    ct.constraint = {
      case: 'intDiv',
      value: create(LinearArgumentProtoSchema, {
        target: toAffineProto(method, target),
        exprs: [toAffineProto(method, num), toAffineProto(method, denom)],
      }),
    };
    return new Constraint(ct);
  }

  /** target == expr % mod — each expression may use at most one variable, and mod must be > 0 */
  addModuloEquality(target: LinearExprLike, expr: LinearExprLike, mod: LinearExprLike): Constraint {
    const method = 'addModuloEquality';
    const ct = this.addConstraintProto();
    ct.constraint = {
      case: 'intMod',
      value: create(LinearArgumentProtoSchema, {
        target: toAffineProto(method, target),
        exprs: [toAffineProto(method, expr), toAffineProto(method, mod)],
      }),
    };
    return new Constraint(ct);
  }

  /** target == max(exprs) */
  addMaxEquality(target: LinearExprLike, exprs: LinearExprLike[]): Constraint {
    const ct = this.addConstraintProto();
    ct.constraint = {
      case: 'linMax',
      value: create(LinearArgumentProtoSchema, {
        target: toLinearExpr(target).toProto(),
        exprs: exprs.map((e) => toLinearExpr(e).toProto()),
      }),
    };
    return new Constraint(ct);
  }

  /** target == min(exprs), encoded as -target == max(-exprs) */
  addMinEquality(target: LinearExprLike, exprs: LinearExprLike[]): Constraint {
    return this.addMaxEquality(
      toLinearExpr(target).negate(),
      exprs.map((e) => toLinearExpr(e).negate()),
    );
  }

  // ── Objective ──

  minimize(expr: LinearExprLike): void {
    this.setObjective(expr, false);
  }

  maximize(expr: LinearExprLike): void {
    this.setObjective(expr, true);
  }

  // ── Hints ──

  /**
   * Suggest a value for a variable, tried before the search proper begins.
   *
   * A hint is advisory. It does not constrain anything: a wrong one costs search
   * time and nothing else, and cannot change the optimal value. So this is a way
   * to say "start from here", not a way to fix a variable — use `add(v.equals(n))`
   * for that.
   *
   * Hints may be partial, and usually should be. Naming the few variables that
   * decide a solution lets propagation derive the rest, which is both less work to
   * build and less to get wrong than spelling out every variable.
   */
  addHint(variable: IntVar, value: number | bigint): void {
    this.hints.set(variable.index, BigInt(value));
  }

  /** Forget every hint added so far. */
  clearHints(): void {
    this.hints.clear();
  }

  // ── Serialization ──

  toProto(): CpModelProto {
    // Materialised here rather than on each addHint so that clearing hints really
    // does leave the proto as it was, and so repeated calls stay idempotent.
    this.proto.solutionHint = this.hints.size
      ? create(PartialVariableAssignmentSchema, {
          vars: [...this.hints.keys()],
          values: [...this.hints.values()],
        })
      : undefined;
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

/**
 * CP-SAT rejects intProd, intDiv and intMod when any expression has more than one
 * variable, but only as MODEL_INVALID at solve time. Failing here instead puts the
 * stack trace at the call that built the bad constraint.
 */
function toAffineProto(method: string, value: LinearExprLike): LinearExpressionProto {
  const expr = toLinearExpr(value);
  if (expr.terms.size > 1) {
    throw new Error(
      `${method}: each expression may use at most one variable, but one uses ${expr.terms.size}. ` +
        'Add an intermediate variable, constrain it to equal the expression, and pass that instead.',
    );
  }
  return expr.toProto();
}
