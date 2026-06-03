import "server-only";
import { Pool } from "pg";
import type {
  TaskCostRow,
  DailyCostRow,
  KindCostRow,
  CostSummary,
  Budget,
} from "./types";

let _pool: Pool | null = null;

export function getPool(): Pool {
  if (_pool) return _pool;
  const connectionString = process.env.AGENTICOS_DB_URL;
  if (!connectionString) throw new Error("AGENTICOS_DB_URL not set");
  _pool = new Pool({ connectionString, max: 5 });
  return _pool;
}

export async function getCostSummary(): Promise<CostSummary> {
  const pool = getPool();
  const {
    rows: [r],
  } = await pool.query<{
    today_cents: number;
    yesterday_cents: number;
    mtd_cents: number;
    cap_cents: number;
    soft_alert_pct: number;
    days_elapsed: number;
    days_in_month: number;
  }>(`
    WITH b AS (SELECT monthly_cap_cents, soft_alert_pct FROM budget WHERE id = 1)
    SELECT
      (SELECT COALESCE(SUM(cost_cents), 0)::int FROM calls
         WHERE occurred_at::date = current_date)              AS today_cents,
      (SELECT COALESCE(SUM(cost_cents), 0)::int FROM calls
         WHERE occurred_at::date = current_date - 1)           AS yesterday_cents,
      (SELECT COALESCE(SUM(cost_cents), 0)::int FROM calls
         WHERE occurred_at >= date_trunc('month', now()))      AS mtd_cents,
      b.monthly_cap_cents                                       AS cap_cents,
      b.soft_alert_pct                                          AS soft_alert_pct,
      EXTRACT(DAY FROM now())::int                              AS days_elapsed,
      EXTRACT(DAY FROM
        (date_trunc('month', now()) + INTERVAL '1 month - 1 day')
      )::int                                                    AS days_in_month
    FROM b
  `);

  const projected =
    r.days_elapsed === 0
      ? 0
      : Math.round(r.mtd_cents * (r.days_in_month / r.days_elapsed));

  return {
    today_cents: r.today_cents,
    yesterday_cents: r.yesterday_cents,
    mtd_cents: r.mtd_cents,
    cap_cents: r.cap_cents,
    soft_alert_cents: Math.round(r.cap_cents * (r.soft_alert_pct / 100)),
    pct_of_cap:
      r.cap_cents === 0 ? 0 : Math.round((100 * r.mtd_cents) / r.cap_cents),
    projected_month_end_cents: projected,
  };
}

export async function getTodayTasks(): Promise<TaskCostRow[]> {
  const pool = getPool();
  const { rows } = await pool.query<TaskCostRow>(`
    SELECT id AS task_id, kind, status, started_at::text, cost_cents
    FROM tasks
    WHERE started_at::date = current_date
    ORDER BY started_at DESC
    LIMIT 100
  `);
  return rows;
}

export async function getMonthByDay(): Promise<DailyCostRow[]> {
  const pool = getPool();
  const { rows } = await pool.query<DailyCostRow>(`
    SELECT to_char(date_trunc('day', occurred_at), 'YYYY-MM-DD') AS day,
           SUM(cost_cents)::int AS cost_cents
    FROM calls
    WHERE occurred_at >= date_trunc('month', now())
    GROUP BY 1
    ORDER BY 1
  `);
  return rows;
}

export async function getMonthByKind(): Promise<KindCostRow[]> {
  const pool = getPool();
  const { rows } = await pool.query<KindCostRow>(`
    SELECT t.kind, SUM(c.cost_cents)::int AS cost_cents
    FROM calls c JOIN tasks t ON c.task_id = t.id
    WHERE c.occurred_at >= date_trunc('month', now())
    GROUP BY t.kind
    ORDER BY 2 DESC
  `);
  return rows;
}

export async function getBudget(): Promise<Budget> {
  const pool = getPool();
  const {
    rows: [r],
  } = await pool.query<Budget>(
    "SELECT monthly_cap_cents, soft_alert_pct, reset_day_of_month FROM budget WHERE id = 1",
  );
  return r;
}

export async function updateBudget(b: Partial<Budget>): Promise<Budget> {
  const pool = getPool();
  const {
    rows: [r],
  } = await pool.query<Budget>(
    `UPDATE budget SET
       monthly_cap_cents  = COALESCE($1, monthly_cap_cents),
       soft_alert_pct     = COALESCE($2, soft_alert_pct),
       reset_day_of_month = COALESCE($3, reset_day_of_month)
     WHERE id = 1
     RETURNING monthly_cap_cents, soft_alert_pct, reset_day_of_month`,
    [b.monthly_cap_cents, b.soft_alert_pct, b.reset_day_of_month],
  );
  return r;
}
