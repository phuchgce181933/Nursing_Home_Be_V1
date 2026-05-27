const cron = require('node-cron');
const { isFirebaseEnabled } = require('../config/firebaseAdmin');
const { publishTodayReadiness } = require('../services/readinessSyncService');

let started = false;

const startReadinessSyncJob = () => {
  if (started || !isFirebaseEnabled()) return;
  started = true;

  cron.schedule('* * * * *', () => {
    publishTodayReadiness().catch((err) =>
      console.warn('[readinessSyncJob] Minute sync failed:', err.message)
    );
  });

  publishTodayReadiness().catch((err) =>
    console.warn('[readinessSyncJob] Initial sync failed:', err.message)
  );

  console.log('[readinessSyncJob] Scheduled emergency readiness sync every minute');
};

module.exports = { startReadinessSyncJob };
