const cron = require('node-cron');
const { autoSkipTasksPastShiftEnd } = require('../services/careTaskService');

let started = false;

const startCareTaskAutoSkipJob = () => {
  if (started) return;
  started = true;

  cron.schedule('*/5 * * * *', () => {
    autoSkipTasksPastShiftEnd().catch((err) =>
      console.warn('[careTaskAutoSkipJob] Run failed:', err.message)
    );
  });

  autoSkipTasksPastShiftEnd().catch((err) =>
    console.warn('[careTaskAutoSkipJob] Initial run failed:', err.message)
  );

  console.log('[careTaskAutoSkipJob] Scheduled care task auto-missed after shift end (every 5 min)');
};

module.exports = { startCareTaskAutoSkipJob };
