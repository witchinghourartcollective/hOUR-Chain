// Deterministic obligation calculation (docs/TIME-CONTRIBUTIONS.md step 6).
// Integer arithmetic only, using BigInt so products cannot overflow. Amounts
// round down; the dropped fraction is recorded, never silently lost.
export class CalculationError extends Error {}

const MAX = BigInt(Number.MAX_SAFE_INTEGER);

export function calculateObligation({ agreement, contribution, revenue }) {
  switch (agreement.basis) {
    case 'fixed_fee':
      return result('fixed_fee', `feeMinor ${agreement.feeMinor}`, BigInt(agreement.feeMinor), 0n, 1n);
    case 'hourly_rate': {
      const numerator = BigInt(contribution.durationSeconds) * BigInt(agreement.rateMinorPerHour);
      return result('hourly_rate',
        `floor(${contribution.durationSeconds}s * ${agreement.rateMinorPerHour}/h / 3600)`,
        numerator / 3600n, numerator % 3600n, 3600n);
    }
    case 'revenue_share': {
      if (!revenue) throw new CalculationError('revenue_share requires a revenue report');
      const numerator = BigInt(revenue.amountMinor) * BigInt(agreement.shareBps);
      return result('revenue_share',
        `floor(${revenue.amountMinor} * ${agreement.shareBps}bps / 10000)`,
        numerator / 10000n, numerator % 10000n, 10000n);
    }
    default:
      throw new CalculationError(`unknown basis ${agreement.basis}`);
  }
}

function result(basis, formula, amount, remainder, denominator) {
  if (amount < 1n) throw new CalculationError(`${formula} rounds to less than one minor unit`);
  if (amount > MAX) throw new CalculationError(`${formula} exceeds the safe integer range`);
  return {
    amountMinor: Number(amount),
    calculation: { basis, formula, remainderNumerator: Number(remainder), remainderDenominator: Number(denominator) },
  };
}
