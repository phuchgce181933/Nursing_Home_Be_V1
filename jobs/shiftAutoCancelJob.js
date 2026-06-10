const cron = require('node-cron');
const { autoCancelUnconfirmedPublishedShifts } = require('../services/shiftService');

let started = false;

const runAutoCancel = async () => {
  const { cancelled, skipped } = await autoCancelUnconfirmedPublishedShifts();
  if (cancelled > 0 || skipped > 0) {
    console.log(`[shiftAutoCancelJob] cancelled=${cancelled} skipped=${skipped}`);
  }
  return { cancelled, skipped };
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
    '[shiftAutoCancelJob] Scheduled auto-cancel for unconfirmed published shifts (every 5 min, 30 min grace)'
  );
};

module.exports = { startShiftAutoCancelJob, runAutoCancel };
