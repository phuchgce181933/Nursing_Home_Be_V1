const cron = require('node-cron');
const { autoRejectExpiredPending } = require('../services/leaveRequestService');

let started = false;

const startLeaveRequestAutoRejectJob = () => {
  if (started) return;
  started = true;

  cron.schedule('5 * * * *', () => {
    autoRejectExpiredPending().catch((err) =>
      console.warn('[leaveRequestAutoRejectJob] Run failed:', err.message)
    );
  });

  autoRejectExpiredPending().catch((err) =>
    console.warn('[leaveRequestAutoRejectJob] Initial run failed:', err.message)
  );

  console.log('[leaveRequestAutoRejectJob] Scheduled expired pending leave auto-reject (hourly)');
};

module.exports = { startLeaveRequestAutoRejectJob };
