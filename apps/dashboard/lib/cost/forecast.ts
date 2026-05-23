interface ForecastArgs {
  mtd_cents: number;
  days_elapsed: number;
  days_in_month: number;
}

/**
 * Project month-end spend by linear extrapolation of MTD.
 *
 * Simple model — assumes spend rate is constant. Not a Bayesian forecast;
 * we'll improve this in a later spec if needed. Good enough for v1.
 */
export function projectMonthEnd({
  mtd_cents,
  days_elapsed,
  days_in_month,
}: ForecastArgs): number {
  if (days_elapsed === 0) return 0;
  return Math.round(mtd_cents * (days_in_month / days_elapsed));
}
