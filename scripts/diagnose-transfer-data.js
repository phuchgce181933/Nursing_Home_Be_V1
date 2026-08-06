/**
 * Diagnose resident/bed/room data drift that breaks room transfer.
 * Run: node scripts/diagnose-transfer-data.js
 * Fix: node scripts/diagnose-transfer-data.js --fix
 */
require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

process.env.NODE_ENV = process.env.NODE_ENV || 'local';

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const {
  diagnoseTransferData,
  syncAllRoomOccupancy,
} = require('../utils/roomOccupancySync');

const shouldFix = process.argv.includes('--fix');

(async () => {
  await connectDB();

  console.log('=== Transfer data diagnosis ===\n');
  const issues = await diagnoseTransferData();

  if (!issues.length) {
    console.log('No issues found.');
  } else {
    const byType = issues.reduce((acc, item) => {
      acc[item.type] = (acc[item.type] || 0) + 1;
      return acc;
    }, {});
    console.log('Summary:', byType);
    console.log('\nDetails:');
    for (const issue of issues) {
      console.log(JSON.stringify(issue, null, 2));
    }
  }

  if (shouldFix) {
    console.log('\n=== Applying room/bed sync ===\n');
    const results = await syncAllRoomOccupancy({ fix: true });
    const changed = results.filter((r) => r.bedUpdates.length > 0 || r.before.occupiedCount !== r.after.occupiedCount);
    console.log(`Synced ${results.length} rooms, ${changed.length} with changes.`);
    for (const row of changed) {
      console.log(JSON.stringify({
        roomNumber: row.roomNumber,
        before: row.before,
        after: row.after,
        bedUpdates: row.bedUpdates,
      }, null, 2));
    }

    console.log('\n=== Re-diagnosis after fix ===\n');
    const afterIssues = await diagnoseTransferData();
    console.log(afterIssues.length ? afterIssues : 'No issues remaining.');
  } else if (issues.length) {
    console.log('\nRun with --fix to sync room occupancy and bed assignment flags.');
  }

  await mongoose.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
