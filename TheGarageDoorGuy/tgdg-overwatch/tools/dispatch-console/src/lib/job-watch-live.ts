import { businessTimeZone, calendarDayBounds } from "./availability";
import { hcpApi } from "./hcp-client";
import { employeeToTechnician, isCanceled } from "./hcp-sync";
import type { WatchHelpers } from "./job-watch";
import { describeSyncError } from "./sync-status";

// The real helpers and the real Housecall Pro connection for Job Watch (the engine itself, job-watch.ts, only imports
// types so that it can be tested directly).
export const liveWatchHelpers: WatchHelpers = {
  timeZone: businessTimeZone,
  dayBounds: calendarDayBounds,
  isCanceled,
  employeeName: (e) => employeeToTechnician(e).name,
  describeError: describeSyncError,
};

export { hcpApi };
