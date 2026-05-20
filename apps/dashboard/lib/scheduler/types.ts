import type { ScheduleRecord } from "@agenticos/hermes-client";
export type { ScheduleRecord };

export interface CronFile {
  version: 1;
  schedules: ScheduleRecord[];
}
