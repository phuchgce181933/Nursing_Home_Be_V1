/**
 * Fix audit log targetName for Invoice records.
 * Old audit logs store ObjectId as targetName instead of invoice.invoiceNumber.
 * Run: node scripts/fix-auditlog-invoice-targetname.js
 */
require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

process.env.NODE_ENV = process.env.NODE_ENV || 'local';

const mongoose = require('mongoose');
const connectDB = require('../config/db');

const AuditLog = require('../models/auditLog');
const Invoice = require('../models/invoice');

async function fixAuditLogInvoiceTargetName() {
  await connectDB();

  // Find all Invoice audit logs where targetName looks like an ObjectId (24 hex chars)
  // or is missing
  const pattern = /^[0-9a-f]{24}$/i;

  const logs = await AuditLog.find({
    targetEntityType: 'Invoice',
    $or: [
      { targetName: { $regex: pattern } },
      { targetName: null },
      { targetName: { $exists: false } },
    ],
  }).lean();

  if (logs.length === 0) {
    console.log('✅ No audit logs need fixing.');
    await mongoose.disconnect();
    return;
  }

  console.log(`Found ${logs.length} audit log(s) to fix.`);
  let fixed = 0;
  let skipped = 0;

  for (const log of logs) {
    const invoice = await Invoice.findById(log.targetEntityId).select('invoiceNumber').lean();
    if (!invoice) {
      console.warn(`⚠️  Invoice not found for log ${log._id}, skipping.`);
      skipped++;
      continue;
    }

    const newTargetName = invoice.invoiceNumber || log.targetEntityId?.toString();
    await AuditLog.updateOne({ _id: log._id }, { $set: { targetName: newTargetName } });
    fixed++;
    console.log(`  ✅ Fixed log ${log._id} → ${newTargetName}`);
  }

  console.log(`\nDone: ${fixed} fixed, ${skipped} skipped.`);
  await mongoose.disconnect();
}

fixAuditLogInvoiceTargetName().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
