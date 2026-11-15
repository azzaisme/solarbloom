import Decimal from 'break_infinity.js';

/**
 * Phase 5 E12: large numbers. Every resource quantity (balances, storage, costs, rewards and income totals) is a
 * break_infinity `Decimal`: a double mantissa with an integer exponent, so it stays exact to ~15 significant
 * digits at any size up to about 1e9e15. Small per-tile and per-machine coefficients stay plain numbers and are
 * multiplied into Decimals where they are summed.
 *
 * Rules (tested in tests/big.test.ts):
 *  - finite and non-negative: NaN, ±Infinity and negatives become 0 at every entry point (`big`);
 *  - deterministic: no randomness and no locale in formatting;
 *  - supported maximum `BIG_MAX` (1e100000). Nothing ordinary gets near it; anything above is clamped there and
 *    reported once to the console (a bug, never a game rule).
 */
export { Decimal };
export type Big = Decimal;
/** Anything a Decimal can be made from. Game code passes numbers or Decimals; saves pass strings. */
export type BigLike = Decimal | number | string;

export const BIG_MAX = Decimal.fromMantissaExponent(1, 100000);
let warned = false;

/** A sanitised, finite, non-negative Decimal. */
export function big(x: BigLike | undefined | null): Decimal {
  if (x === undefined || x === null) return new Decimal(0);
  let d: Decimal;
  if (x instanceof Decimal) d = x;
  else if (typeof x === 'number') {
    if (!Number.isFinite(x) || x <= 0) return new Decimal(0);
    return new Decimal(x);
  } else {
    try {
      d = new Decimal(x);
    } catch {
      return new Decimal(0);
    }
  }
  // NaN, infinities (break_infinity marks them with an exponent of 9e15), zero and negatives all become 0.
  if (!Number.isFinite(d.mantissa) || !Number.isFinite(d.exponent) || d.mantissa <= 0 || d.exponent >= 9e15) return new Decimal(0);
  if (d.gt(BIG_MAX)) {
    if (!warned) {
      warned = true;
      console.warn('[solarbloom] a resource amount passed the supported maximum (1e100000) and was clamped');
    }
    return BIG_MAX;
  }
  return d;
}

export const ZERO = new Decimal(0);

/** For presentation and ratios only (bars, ETAs): a plain number, Infinity past 1e308. */
export function toNum(x: BigLike): number {
  return big(x).toNumber();
}

/** "1.50" → "1.5", "2.00" → "2"; never touches whole numbers ("160" stays "160"). */
const trimZeros = (x: string) => (x.includes('.') ? x.replace(/0+$/, '').replace(/\.$/, '') : x);

const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];

/**
 * Short display: 7.5 · 950 · 12.3K · 4.56M · 7.89T · … up to Dc (1e33), then 1.23e45. Rounds down so a
 * shown balance is never more than the real one. `decimals` applies below 10 (e.g. rates like 2.5/s).
 */
export function fmt(x: BigLike, decimals = 0): string {
  const d = big(x);
  if (d.lt(1000)) {
    const n = d.toNumber();
    if (decimals > 0 && n < 10) {
      const p = 10 ** decimals;
      return String(Math.floor(n * p + 1e-9) / p);
    }
    return String(Math.floor(n + 1e-9));
  }
  const e = d.exponent;
  const group = Math.floor(e / 3);
  if (group < SUFFIXES.length) {
    const v = d.mantissa * 10 ** (e - group * 3); // 1 ≤ v < 1000
    const digits = v < 10 ? 2 : v < 100 ? 1 : 0;
    const p = 10 ** digits;
    const shown = Math.floor(v * p + 1e-9) / p;
    return `${trimZeros(shown.toFixed(digits))}${SUFFIXES[group]}`;
  }
  const m = Math.floor(d.mantissa * 100 + 1e-9) / 100;
  return `${trimZeros(m.toFixed(2))}e${e}`;
}

/** Rounds a cost up to a whole number (exact below 1e15; past that the mantissa is already whole). */
export function ceilBig(x: BigLike): Decimal {
  return big(x).ceil();
}

/** Plain JSON for a Decimal (break_infinity's own toJSON, made explicit for saves). */
export function bigToJSON(x: Decimal): string {
  return x.toString();
}
