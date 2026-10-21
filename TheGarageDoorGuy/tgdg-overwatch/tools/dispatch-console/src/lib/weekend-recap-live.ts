import { businessTimeZone } from "./availability";
import { isCanceled } from "./hcp-sync";
import { classifyJob, employeeNames, jobLabel, jobUrl, readWatchRules, techNames } from "./job-watch";
import { hcpApi, liveWatchHelpers } from "./job-watch-live";
import { describeSyncError } from "./sync-status";
import { getWeekendRecap, readRecapRules, type RecapResult } from "./weekend-recap";

// The real Housecall Pro connection and settings for the weekend recap (the engine itself, weekend-recap.ts, only
// imports types so that it can be tested directly). Reads the same settings as Job Watch (install words, the Go to
// job address, whether notes may be shown) so the two always agree.
export async function getLiveWeekendRecap(back: number, fresh = false): Promise<RecapResult> {
  const watch = readWatchRules();
  return getWeekendRecap({
    api: hcpApi,
    back,
    fresh,
    rules: readRecapRules(process.env, watch.showNotes),
    helpers: {
      timeZone: businessTimeZone,
      isCanceled,
      classify: (job) => classifyJob(job, watch.installWords),
      label: jobLabel,
      url: (id) => jobUrl(watch.jobUrlTemplate, id),
      techNames,
      employeeNames: () => employeeNames(hcpApi, new Date(), liveWatchHelpers),
      describeError: describeSyncError,
    },
  });
}
