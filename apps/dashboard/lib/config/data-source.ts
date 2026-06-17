/**
 * dataSource() — feature-flag helper for the dashboard data source.
 *
 * Returns "paperclip" iff DASHBOARD_DATA_SOURCE is exactly "paperclip";
 * otherwise returns "hermes" (the default).
 */
export function dataSource(): "hermes" | "paperclip" {
  return process.env.DASHBOARD_DATA_SOURCE === "paperclip" ? "paperclip" : "hermes";
}
