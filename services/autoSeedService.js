const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const mongoose = require('mongoose');

const SEED_FILE = path.join(__dirname, '../scripts/seed.js');

const getSeedHash = () =>
  crypto.createHash('md5').update(fs.readFileSync(SEED_FILE)).digest('hex');

/**
 * So sánh hash của scripts/seed.js với hash đã lưu trong DB.
 * - Nếu khớp  → bỏ qua (seed không thay đổi).
 * - Nếu khác  → chạy seed, lưu hash mới.
 * Gọi một lần trong initDB() khi server khởi động.
 */
const runAutoSeedIfNeeded = async () => {
  const currentHash = getSeedHash();
  const col  = mongoose.connection.db.collection('seedmeta');
  const meta = await col.findOne({ key: 'seed_hash' });

  if (meta?.value === currentHash) {
    console.log('ℹ️  Seed up to date — skipping auto-seed.');
    return;
  }

  const { seed } = require('../scripts/seed');

  if (typeof seed !== 'function') {
    console.log('ℹ️  Auto-seed disabled (scripts/seed.js exports no seed function) — skipping.');
    return;
  }

  const reason = meta ? '🔄 Seed file changed' : '🌱 No seed data found';
  console.log(`${reason} — running auto-seed (additive mode)...`);

  await seed({ force: false }); // upsert structural, skip content nếu đã có

  await col.updateOne(
    { key: 'seed_hash' },
    { $set: { value: currentHash, seededAt: new Date() } },
    { upsert: true },
  );

  console.log('✅ Auto-seed completed.');
};

module.exports = { runAutoSeedIfNeeded };
