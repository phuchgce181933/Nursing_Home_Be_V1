const mongoose = require('mongoose');

const NON_TX_ERROR_PATTERNS = [
  /retryable writes/i,
  /replica set/i,
  /Transaction numbers are only allowed on a replica set member or mongos/i,
  /does not support transactions/i,
];

const isNonTxErr = (err) => NON_TX_ERROR_PATTERNS.some((re) => re.test(String(err?.message || '')));

// Runs `work(session)` inside a Mongo transaction, falling back to a plain
// (non-transactional) call when the deployment doesn't support transactions
// (e.g. a standalone MongoDB instance without a replica set).
const runWithOptionalTransaction = async (work) => {
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(() => work(session));
  } catch (err) {
    if (isNonTxErr(err)) {
      console.warn('[transaction] Transaction unsupported, fallback to non-transaction mode:', err.message);
      return work(null);
    }
    throw err;
  } finally {
    await session.endSession();
  }
};

module.exports = { runWithOptionalTransaction };
