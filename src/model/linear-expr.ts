import { create } from '@bufbuild/protobuf';
import {
  LinearExpressionProtoSchema,
  type LinearExpressionProto,
} from '../generated/cp_model_pb.js';

/**
 * Represents a linear expression: sum(coeffs[i] * vars[i]) + offset.
 * Used to build constraints and objectives in CP-SAT models.
 */
export class LinearExpr {
  /** Map from variable index to coefficient */
  readonly terms: ReadonlyMap<number, bigint>;
  readonly offset: bigint;

  constructor(terms: Map<number, bigint>, offset: bigint) {
    this.terms = terms;
    this.offset = offset;
  }

  static fromConstant(value: number | bigint): LinearExpr {
    return new LinearExpr(new Map(), BigInt(value));
  }

  static fromVarIndex(varIndex: number, coeff: bigint = 1n): LinearExpr {
    return new LinearExpr(new Map([[varIndex, coeff]]), 0n);
  }

  plus(other: LinearExpr | number | bigint): LinearExpr {
    if (typeof other === 'number' || typeof other === 'bigint') {
      return new LinearExpr(new Map(this.terms), this.offset + BigInt(other));
    }
    const newTerms = new Map(this.terms);
    for (const [varIdx, coeff] of other.terms) {
      const existing = newTerms.get(varIdx) ?? 0n;
      const sum = existing + coeff;
      if (sum === 0n) {
        newTerms.delete(varIdx);
      } else {
        newTerms.set(varIdx, sum);
      }
    }
    return new LinearExpr(newTerms, this.offset + other.offset);
  }

  minus(other: LinearExpr | number | bigint): LinearExpr {
    if (typeof other === 'number' || typeof other === 'bigint') {
      return new LinearExpr(new Map(this.terms), this.offset - BigInt(other));
    }
    return this.plus(other.times(-1));
  }

  times(scalar: number | bigint): LinearExpr {
    const s = BigInt(scalar);
    if (s === 0n) {
      return LinearExpr.fromConstant(0);
    }
    const newTerms = new Map<number, bigint>();
    for (const [varIdx, coeff] of this.terms) {
      newTerms.set(varIdx, coeff * s);
    }
    return new LinearExpr(newTerms, this.offset * s);
  }

  negate(): LinearExpr {
    return this.times(-1);
  }

  /** expr == value */
  equals(other: LinearExpr | number | bigint): BoundedLinearExpression {
    const rhs = typeof other === 'number' || typeof other === 'bigint'
      ? LinearExpr.fromConstant(other) : other;
    const diff = this.minus(rhs);
    return new BoundedLinearExpression(diff, 0n, 0n);
  }

  /** expr <= value */
  le(other: LinearExpr | number | bigint): BoundedLinearExpression {
    const rhs = typeof other === 'number' || typeof other === 'bigint'
      ? LinearExpr.fromConstant(other) : other;
    const diff = this.minus(rhs);
    return new BoundedLinearExpression(diff, -4503599627370496n, 0n);
  }

  /** expr >= value */
  ge(other: LinearExpr | number | bigint): BoundedLinearExpression {
    const rhs = typeof other === 'number' || typeof other === 'bigint'
      ? LinearExpr.fromConstant(other) : other;
    const diff = this.minus(rhs);
    return new BoundedLinearExpression(diff, 0n, 4503599627370496n);
  }

  /** expr < value */
  lt(other: LinearExpr | number | bigint): BoundedLinearExpression {
    const rhs = typeof other === 'number' || typeof other === 'bigint'
      ? LinearExpr.fromConstant(other) : other;
    const diff = this.minus(rhs);
    return new BoundedLinearExpression(diff, -4503599627370496n, -1n);
  }

  /** expr > value */
  gt(other: LinearExpr | number | bigint): BoundedLinearExpression {
    const rhs = typeof other === 'number' || typeof other === 'bigint'
      ? LinearExpr.fromConstant(other) : other;
    const diff = this.minus(rhs);
    return new BoundedLinearExpression(diff, 1n, 4503599627370496n);
  }

  toProto(): LinearExpressionProto {
    const vars: number[] = [];
    const coeffs: bigint[] = [];
    for (const [varIdx, coeff] of this.terms) {
      vars.push(varIdx);
      coeffs.push(coeff);
    }
    return create(LinearExpressionProtoSchema, {
      vars,
      coeffs,
      offset: this.offset,
    });
  }
}

/**
 * Represents a bounded linear expression: lb <= expr <= ub.
 * Created by comparison methods on LinearExpr/IntVar.
 */
export class BoundedLinearExpression {
  readonly expr: LinearExpr;
  readonly lb: bigint;
  readonly ub: bigint;

  constructor(expr: LinearExpr, lb: bigint, ub: bigint) {
    this.expr = expr;
    this.lb = lb;
    this.ub = ub;
  }
}

/** Helper to convert something that could be LinearExpr, number, or has toLinearExpr() */
export function toLinearExpr(value: LinearExpr | number | bigint | { toLinearExpr(): LinearExpr }): LinearExpr {
  if (value instanceof LinearExpr) return value;
  if (typeof value === 'number' || typeof value === 'bigint') return LinearExpr.fromConstant(value);
  return value.toLinearExpr();
}
