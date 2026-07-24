const cron = require('node-cron');
const {
  autoCancelUnconfirmedPublishedShifts,
  autoCancelUncompletedConfirmedShifts,
} = require('../services/shiftService');

let started = false;

const runAutoCancel = async () => {
  const unconfirmed = await autoCancelUnconfirmedPublishedShifts();
  const missedCompletion = await autoCancelUncompletedConfirmedShifts();
  const cancelled = unconfirmed.cancelled + missedCompletion.cancelled;
  const skipped = unconfirmed.skipped + missedCompletion.skipped;
  if (cancelled > 0 || skipped > 0) {
    console.log(
      `[shiftAutoCancelJob] unconfirmedCancelled=${unconfirmed.cancelled} missedCompletionCancelled=${missedCompletion.cancelled} skipped=${skipped}`
    );
  }
  return { cancelled, skipped, unconfirmed, missedCompletion };
};

const startShiftAutoCancelJob = () => {
  if (started) return;
  started = true;

  cron.schedule('*/5 * * * *', () => {
    runAutoCancel().catch((err) =>
      console.warn('[shiftAutoCancelJob] Run failed:', err.message)
    );
  });

  runAutoCancel().catch((err) =>
    console.warn('[shiftAutoCancelJob] Initial run failed:', err.message)
  );

  console.log(
    '[shiftAutoCancelJob] Scheduled auto-cancel for unconfirmed published shifts and missed completion (every 5 min)'
  );
};

module.exports = { startShiftAutoCancelJob, runAutoCancel };
