import fs from 'node:fs';
import path from 'node:path';

export function shanghaiClock(now = new Date()) {
  const shifted = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return { date: shifted.toISOString().slice(0, 10).replaceAll('-', ''), minute: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(), weekday: shifted.getUTCDay() };
}

export function previousWeekday(now = new Date(), cutoff = 15 * 60 + 50) {
  const clock = shanghaiClock(now);
  const day = new Date(`${clock.date.slice(0, 4)}-${clock.date.slice(4, 6)}-${clock.date.slice(6)}T00:00:00Z`);
  if (clock.minute < cutoff) day.setUTCDate(day.getUTCDate() - 1);
  while ([0, 6].includes(day.getUTCDay())) day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10).replaceAll('-', '');
}

export function readSchedulerState(statePath) {
  try { return JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch { return { version: 1, jobs: {} }; }
}

// Persist attempts before work so a restart resumes failed or interrupted jobs.
export function createDurableScheduler({ statePath, jobs, now = () => new Date(), retryMs = 15 * 60 * 1000, intervalMs = 60000 }) {
  let state = readSchedulerState(statePath);
  state.jobs ??= {};
  let planning = false;
  const active = new Map();
  // Jobs with the same resource share a lock while their work is in flight.
  // This is useful when two schedules are intentionally separate (for
  // example, an initial download and an overnight verification) but invoke
  // the same single-instance provider process.
  const activeResources = new Set();
  let timer = null;
  const save = () => {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    const temporary = `${statePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(state, null, 2));
    fs.renameSync(temporary, statePath);
  };
  async function tick() {
    if (planning) return state;
    planning = true;
    const launched = [];
    try {
      for (const job of jobs) {
        if (active.has(job.name)) continue;
        if (job.resource && activeResources.has(job.resource)) continue;
        const current = now();
        if (job.allowed && !job.allowed(current)) continue;
        let dates;
        try { dates = await job.dates(current); } catch (error) {
          state.planningError = `${job.name}: ${error.message}`;
          save();
          continue;
        }
        const pendingDates = [];
        for (const date of dates) {
          const key = `${job.name}:${date}`;
          const previous = state.jobs[key];
          if (previous?.status === 'completed') {
            // Completed jobs can have been reconciled by an older scheduler
            // instance with only a boolean marker. Refresh missing summary
            // metadata without rerunning the expensive job itself.
            if (job.isComplete && previous.result?.reconciled && previous.result?.count == null) {
              try {
                const completion = await job.isComplete(date, previous);
                if (completion && typeof completion === 'object') {
                  state.jobs[key] = { ...previous, result: { ...completion, reconciled: true } };
                  save();
                }
              } catch {
                // The durable completed state remains valid if metadata is
                // temporarily unavailable.
              }
            }
            continue;
          }
          // A job may also be completed by an API endpoint or another
          // process. Reconcile that durable source before honoring a stale
          // retry backoff from the old scheduler instance.
          if (job.isComplete) {
            try {
              const completion = await job.isComplete(date, previous);
              const complete = completion === true || completion?.ok === true || completion?.success === true;
              if (complete) {
                const result = completion === true ? { reconciled: true } : { ...completion, reconciled: true };
                state.jobs[key] = { ...previous, name: job.name, date, status: 'completed', completedAt: now().toISOString(), result };
                delete state.jobs[key].error;
                delete state.jobs[key].retryAt;
                save();
                continue;
              }
            } catch {
              // The source may be temporarily unavailable; normal retry
              // handling below remains authoritative for this tick.
            }
          }
          if (!(previous?.retryAt && Date.parse(previous.retryAt) > current.getTime())) pendingDates.push(date);
        }
        // Do not acquire a job/resource slot for a no-op scan of completed
        // dates. Otherwise a completed first schedule can starve a second
        // schedule that shares its provider resource forever.
        if (!pendingDates.length) continue;
        const run = async () => { for (const date of pendingDates) {
          const key = `${job.name}:${date}`;
          const previous = state.jobs[key];
          if (previous?.status === 'completed') continue;
          if (previous?.retryAt && Date.parse(previous.retryAt) > current.getTime()) continue;
          state.jobs[key] = { name: job.name, date, status: 'running', attempt: (previous?.attempt || 0) + 1, startedAt: now().toISOString() };
          save();
          try {
            const result = await job.run(date);
            if (result?.success !== true && result?.ok !== true) throw new Error(result?.error || result?.warning || result?.errors?.join('; ') || 'Job did not confirm success');
            state.jobs[key] = { ...state.jobs[key], status: 'completed', completedAt: now().toISOString(), result };
          } catch (error) {
            const attempts = state.jobs[key].attempt;
            const delay = Math.min(retryMs * 2 ** Math.min(4, attempts - 1), 4 * 60 * 60 * 1000);
            state.jobs[key] = { ...state.jobs[key], status: 'failed', error: error.message, retryAt: new Date(now().getTime() + delay).toISOString() };
          }
          state.lastCheckedAt = now().toISOString();
          save();
        } };
        const pending = run().finally(() => {
          active.delete(job.name);
          if (job.resource) activeResources.delete(job.resource);
        });
        active.set(job.name, pending);
        if (job.resource) activeResources.add(job.resource);
        launched.push(pending);
      }
      state.lastCheckedAt = now().toISOString();
      save();
    } finally { planning = false; }
    await Promise.all(launched);
    return state;
  }
  return {
    tick,
    status: () => ({ ...state, running: active.size > 0 }),
    start() { if (!timer) { void tick().catch(console.error); timer = setInterval(() => void tick().catch(console.error), intervalMs); timer.unref?.(); } },
    stop() { clearInterval(timer); timer = null; }
  };
}
