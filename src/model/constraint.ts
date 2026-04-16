import type { ConstraintProto } from '../generated/cp_model_pb.js';
import type { BoolVar, IntVar } from './int-var.js';

/**
 * Wraps a ConstraintProto in the model. Provides reification support
 * via onlyEnforceIf().
 */
export class Constraint {
  readonly proto: ConstraintProto;

  constructor(proto: ConstraintProto) {
    this.proto = proto;
  }

  /**
   * Sets enforcement literals. The constraint is only enforced when
   * all given literals are true.
   */
  onlyEnforceIf(literals: (BoolVar | IntVar | number) | (BoolVar | IntVar | number)[]): this {
    const arr = Array.isArray(literals) ? literals : [literals];
    this.proto.enforcementLiteral = arr.map((lit) =>
      typeof lit === 'number' ? lit : lit.index
    );
    return this;
  }
}
