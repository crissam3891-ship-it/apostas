// src/bets/payout-calculator.ts
import Decimal from 'decimal.js';
export const Dec = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Money = string;
export const ODD_MIN_BONUS = new Dec('1.50');
const DECIMAL_RE = /^\d+(\.\d+)?$/;
const ESCUDO_RATE = new Dec('0.70');
export const ESCUDO_INSTALLMENTS = 3;
function parseDecimal(value: string, label: string): Decimal {
  if (!DECIMAL_RE.test(value)) {
    throw new Error(`${label} inválido: ${value}`);
  }
  return new Dec(value);
}
function parseOdd(odd: string): Decimal {
  const o = parseDecimal(odd, 'odd');
  if (o.lte(1)) {
    throw new Error('odd deve ser maior que 1');
  }
  return o;
}
export function toMoney(value: Decimal): Money {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}
export function calculatePayout(stake: Money, odd: string): Money {
  const s = parseDecimal(stake, 'stake');
  const o = parseOdd(odd);
  return toMoney(s.times(o));
}
export function calculateFreebetPayout(stake: Money, odd: string): Money {
  const s = parseDecimal(stake, 'stake');
  const o = parseOdd(odd);
  return toMoney(s.times(o).minus(s));
}
export interface EscudoRefund {
  total: Money;
  parcelas: [Money, Money, Money];
}
export function calculateEscudoRefund(stake: Money): EscudoRefund {
  const s = parseDecimal(stake, 'stake');
  const total = s.times(ESCUDO_RATE).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const p1 = total.div(ESCUDO_INSTALLMENTS).toDecimalPlaces(2, Decimal.ROUND_DOWN);
  const p2 = p1;
  const p3 = total.minus(p1).minus(p2);
  return {
    total: toMoney(total),
    parcelas: [toMoney(p1), toMoney(p2), toMoney(p3)],
  };
}
