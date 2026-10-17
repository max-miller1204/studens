/** Debounced, sequential draft saves shared by the lesson features. */
export function createDrafts(config) {
  /**
   * Text and answers the learner has typed but not sent are saved as they type, so a
   * reload does not lose them. Each place on the page has one draft key (see draft.mjs).
   * The saves for one key run one at a time, so an older save never lands after a newer
   * one. The server removes a draft when it accepts the text the draft held.
   */
  const DRAFT_DELAY_MS = 400;

  /** draft key → { read, report, timer, running, again } */
  const draftJobs = new Map();

  /**
   * Save a draft soon. `read` returns the value to save, or null to remove the draft.
   * `report(err, value)` shows the result.
   */
  function scheduleDraft(key, read, report) {
    let job = draftJobs.get(key);
    if (!job) {
      job = { timer: null, running: null, again: false };
      draftJobs.set(key, job);
    }
    job.read = read;
    job.report = report;
    clearTimeout(job.timer);
    job.timer = setTimeout(() => void flushDraft(key), DRAFT_DELAY_MS);
  }

  /** Save a draft now. */
  function saveDraftNow(key, read, report) {
    scheduleDraft(key, read, report);
    return flushDraft(key);
  }

  /** Send a waiting save of a draft now, and wait until every save of it is done. */
  function flushDraft(key) {
    const job = draftJobs.get(key);
    if (!job) return Promise.resolve();
    const waiting = job.timer !== null;
    clearTimeout(job.timer);
    job.timer = null;
    if (job.running) {
      if (waiting) job.again = true;
      return job.running;
    }
    if (!waiting) return Promise.resolve();
    job.running = (async () => {
      do {
        job.again = false;
        const value = job.read();
        try {
          const response = await draftRequest(key, value, false);
          const result = await response.json();
          if (!response.ok)
            throw new Error(result.error || `PUT /api/draft returned ${response.status}`);
          job.report(null, value);
        } catch (err) {
          console.error(`[classroom] could not save the draft ${key}`, err);
          job.report(err, value);
        }
      } while (job.again);
      job.running = null;
    })();
    return job.running;
  }

  /**
   * Send every waiting draft while the page goes away. `keepalive` lets the request
   * finish after the page is gone, so nobody is left to read its result.
   */
  function sendWaitingDrafts() {
    for (const [key, job] of draftJobs) {
      if (job.timer === null) continue;
      clearTimeout(job.timer);
      job.timer = null;
      draftRequest(key, job.read(), true).catch((err) =>
        console.error(`[classroom] could not save the draft ${key}`, err),
      );
    }
  }

  function draftRequest(key, value, keepalive) {
    return fetch("/api/draft", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classroom: config.classroom, lesson: config.lesson, key, value }),
      keepalive,
    });
  }

  return { scheduleDraft, saveDraftNow, flushDraft, sendWaitingDrafts };
}

/** A `report` for scheduleDraft that writes the result with `show`. */
export function draftStatus(show, savedText) {
  return (err, value) => {
    if (err) show(`Could not save your draft: ${err.message}`);
    else show(value === null ? "" : savedText);
  };
}
