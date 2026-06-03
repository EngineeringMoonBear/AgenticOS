export interface TaskCostRow {
  task_id: string;
  kind: string;
  status: string;
  started_at: string;
  cost_cents: number;
}

export interface DailyCostRow {
  day: string; // 'YYYY-MM-DD'
  cost_cents: number;
}

export interface KindCostRow {
  kind: string;
  cost_cents: number;
}

export interface CostSummary {
  today_cents: number;
  yesterday_cents: number;
  mtd_cents: number;
  cap_cents: number;
  soft_alert_cents: number;
  pct_of_cap: number;
  projected_month_end_cents: number;
}

export interface Budget {
  monthly_cap_cents: number;
  soft_alert_pct: number;
  reset_day_of_month: number;
}
