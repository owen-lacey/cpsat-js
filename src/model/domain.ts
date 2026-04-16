/**
 * Represents a domain as sorted disjoint intervals [min0, max0, min1, max1, ...].
 * Used for integer variable bounds in CP-SAT.
 */
export class Domain {
  readonly intervals: readonly [bigint, bigint][];

  private constructor(intervals: [bigint, bigint][]) {
    this.intervals = intervals;
  }

  static fromRange(min: number | bigint, max: number | bigint): Domain {
    return new Domain([[BigInt(min), BigInt(max)]]);
  }

  static fromValues(values: (number | bigint)[]): Domain {
    if (values.length === 0) {
      return new Domain([]);
    }
    const sorted = [...values].map(BigInt).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const intervals: [bigint, bigint][] = [];
    let start = sorted[0];
    let end = sorted[0];
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] === end + 1n) {
        end = sorted[i];
      } else {
        intervals.push([start, end]);
        start = sorted[i];
        end = sorted[i];
      }
    }
    intervals.push([start, end]);
    return new Domain(intervals);
  }

  static fromFlattenedIntervals(flat: bigint[]): Domain {
    const intervals: [bigint, bigint][] = [];
    for (let i = 0; i < flat.length; i += 2) {
      intervals.push([flat[i], flat[i + 1]]);
    }
    return new Domain(intervals);
  }

  toFlatBigIntArray(): bigint[] {
    return this.intervals.flatMap(([min, max]) => [min, max]);
  }
}
