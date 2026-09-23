/**
 * backfill_wallet_transactions.js
 * ============================================================================
 * Đối soát sổ cái ví với các bản ghi tài chính đã có (Payment / Invoice) và BỔ
 * SUNG những dòng lịch sử bị thiếu.
 *
 * NGUYÊN TẮC — đọc kỹ trước khi sửa script này:
 *
 *  1. KHÔNG PHÁ HUỶ. Script chỉ THÊM dòng lịch sử. Không xoá, không sửa, không
 *     đụng tới `balance`, `totalTopup`, `totalSpent`. Tiền trong ví sau khi chạy
 *     script đúng bằng trước khi chạy.
 *
 *  2. IDEMPOTENT. Mỗi dòng bổ sung được khoá bằng một định danh ổn định
 *     (`paymentId = BACKFILL-PAYMENT-<paymentId>`). Chạy lần thứ hai không sinh
 *     thêm bản ghi nào.
 *
 *  3. KHÔNG BỊA SỐ DƯ. Dữ liệu cũ không lưu số dư tại thời điểm giao dịch, và
 *     số dư hiện tại KHÔNG cho phép suy ngược (nhiều ví được seed đặt thẳng số
 *     dư, tổng nạp - tổng chi không khớp). Vì vậy mọi dòng backfill đều để trống
 *     balanceBefore/balanceAfter và gắn cờ `backfilled: true`. Phần thiếu được
 *     BÁO CÁO, không được lấp bằng số tự nghĩ ra.
 *
 *  4. CHỈ DB LOCAL. Có chốt chặn cứng ở dưới.
 *
 * Cách chạy:
 *   node scripts/backfill_wallet_transactions.js            # chạy thử, không ghi
 *   node scripts/backfill_wallet_transactions.js --apply    # ghi thật
 */

const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');
const URI = process.env.MONGO_URI_LOCAL || 'mongodb://127.0.0.1:27017/nursing_home_local';

const assertLocalDb = () => {
  if (/^mongodb\+srv:/i.test(URI)) throw new Error('TỪ CHỐI: mongodb+srv (Atlas). Script này chỉ chạy trên DB local.');
  if (!/127\.0\.0\.1|localhost/.test(URI)) throw new Error(`TỪ CHỐI: host không phải local — ${URI.replace(/\/\/.*@/, '//***@')}`);
  if (!/nursing_home_local/.test(URI)) throw new Error('TỪ CHỐI: tên database phải là nursing_home_local.');
};

const money = (n) => Number(n || 0).toLocaleString('vi-VN');
const short = (id) => (id ? `…${String(id).slice(-6)}` : '-');

const run = async () => {
  assertLocalDb();
  await mongoose.connect(URI);
  const db = mongoose.connection.db;

  const wallets = await db.collection('familywallets').find({}).toArray();
  const payments = await db.collection('payments').find({}).toArray();
  const invoices = await db.collection('invoices').find({}).toArray();
  const invoiceById = new Map(invoices.map((i) => [String(i._id), i]));

  console.log(`\n=== ĐỐI SOÁT SỔ CÁI VÍ ${APPLY ? '(GHI THẬT)' : '(CHẠY THỬ — chưa ghi gì)'} ===`);
  console.log(`DB: ${URI}`);
  console.log(`Ví: ${wallets.length} | Payment: ${payments.length} | Hoá đơn: ${invoices.length}\n`);

  const planned = [];   // { userId, tx, why }
  const limitations = []; // những thứ KHÔNG dựng lại được — phải báo cáo, không được đoán

  // ---------------------------------------------------------------------------
  // (A) Payment bằng VÍ nhưng không có dòng nào trong lịch sử ví.
  // ---------------------------------------------------------------------------
  for (const p of payments) {
    if (p.paymentMethod !== 'wallet') continue;
    if (p.paymentStatus !== 'confirmed') continue;

    const userId = p.paidByFamilyAccountId;
    if (!userId) {
      limitations.push(`Payment ${short(p._id)} (ví, ${money(p.amount)}₫) KHÔNG có paidByFamilyAccountId — không biết thuộc ví nào, bỏ qua.`);
      continue;
    }

    const wallet = wallets.find((w) => String(w.userId) === String(userId));
    if (!wallet) {
      limitations.push(`Payment ${short(p._id)} trỏ tới user ${short(userId)} chưa có ví — bỏ qua.`);
      continue;
    }

    const backfillKey = `BACKFILL-PAYMENT-${p._id}`;
    const already = (wallet.transactions || []).some(
      (t) => t.paymentId === backfillKey
        // Đã có dòng "thật" khớp hoá đơn + số tiền thì coi như đủ, không thêm nữa.
        || (t.type === 'payment'
            && Number(t.amount) === Number(p.amount)
            && String(t.invoiceId || '') === String(p.invoiceId || '')
            && t.status === 'completed'),
    );
    if (already) continue;

    const inv = invoiceById.get(String(p.invoiceId));
    planned.push({
      userId,
      why: `Payment ví ${short(p._id)} không có dòng lịch sử`,
      tx: {
        _id: new mongoose.Types.ObjectId(),
        type: 'payment',
        direction: 'debit',
        paymentMethod: 'wallet',
        walletAffected: true,
        amount: Number(p.amount) || 0,
        description: inv?.invoiceNumber ? `Thanh toán hóa đơn ${inv.invoiceNumber}` : 'Thanh toán hóa đơn',
        invoiceId: p.invoiceId || undefined,
        invoiceNumber: inv?.invoiceNumber || undefined,
        paymentId: backfillKey,
        reference: p.transactionRef || undefined,
        status: 'completed',
        backfilled: true,
        // CỐ Ý không có balanceBefore/balanceAfter — xem nguyên tắc 3 ở đầu file.
        createdAt: p.paidAt || p.createdAt || new Date(),
        completedAt: p.confirmedAt || p.paidAt || p.createdAt || new Date(),
      },
    });
  }

  // ---------------------------------------------------------------------------
  // (B) Hoá đơn đã PAID qua PayOS nhưng không có Payment và không có dòng lịch sử.
  // ---------------------------------------------------------------------------
  for (const inv of invoices) {
    if (inv.status !== 'PAID') continue;
    if (!inv.familyAccountId) {
      if (!payments.some((p) => String(p.invoiceId) === String(inv._id))) {
        limitations.push(`Hoá đơn ${inv.invoiceNumber || short(inv._id)} đã PAID (${money(inv.totalAmount)}₫) nhưng KHÔNG có familyAccountId và KHÔNG có Payment — không đủ dữ liệu để quy về ví nào, KHÔNG dựng lại.`);
      }
      continue;
    }
    const hasPayment = payments.some((p) => String(p.invoiceId) === String(inv._id));
    if (hasPayment) continue; // đã xử lý ở nhánh (A) hoặc vốn đã đủ

    const wallet = wallets.find((w) => String(w.userId) === String(inv.familyAccountId));
    if (!wallet) continue;

    const backfillKey = `BACKFILL-INVOICE-${inv._id}`;
    const already = (wallet.transactions || []).some(
      (t) => t.paymentId === backfillKey || String(t.invoiceId || '') === String(inv._id),
    );
    if (already) continue;

    if (!inv.payosOrderCode) {
      limitations.push(`Hoá đơn ${inv.invoiceNumber || short(inv._id)} PAID (${money(inv.totalAmount)}₫) nhưng không có Payment lẫn payosOrderCode — không xác định được đã trả bằng ví hay PayOS, KHÔNG dựng lại.`);
      continue;
    }

    planned.push({
      userId: inv.familyAccountId,
      why: `Hoá đơn PAID qua PayOS ${inv.invoiceNumber || short(inv._id)} thiếu lịch sử`,
      tx: {
        _id: new mongoose.Types.ObjectId(),
        type: 'payment',
        direction: 'none',
        paymentMethod: 'payos',
        walletAffected: false, // tiền KHÔNG đi qua ví
        amount: Number(inv.totalAmount) || 0,
        description: `Thanh toán hóa đơn ${inv.invoiceNumber || ''} qua PayOS`.trim(),
        invoiceId: inv._id,
        invoiceNumber: inv.invoiceNumber || undefined,
        orderCode: Number(inv.payosOrderCode),
        paymentId: backfillKey,
        status: 'completed',
        backfilled: true,
        createdAt: inv.updatedAt || inv.issuedAt || inv.createdAt || new Date(),
        completedAt: inv.updatedAt || inv.issuedAt || inv.createdAt || new Date(),
      },
    });
  }

  // ---------------------------------------------------------------------------
  // (C) Chuẩn hoá bản ghi CŨ: thêm direction/paymentMethod/walletAffected còn
  //     thiếu. Đây là suy luận AN TOÀN từ `type` (không phải bịa số tiền/số dư)
  //     và giúp giao diện không phải đoán. Số tiền tuyệt đối không đổi.
  // ---------------------------------------------------------------------------
  const normalizations = [];
  for (const w of wallets) {
    (w.transactions || []).forEach((t, idx) => {
      if (t.direction && t.paymentMethod && t.walletAffected !== undefined) return;
      normalizations.push({
        walletId: w._id,
        idx,
        set: {
          [`transactions.${idx}.direction`]: t.direction || (t.type === 'payment' ? 'debit' : 'credit'),
          [`transactions.${idx}.paymentMethod`]: t.paymentMethod || (t.type === 'payment' ? 'wallet' : 'payos'),
          [`transactions.${idx}.walletAffected`]: t.walletAffected !== undefined ? t.walletAffected : true,
        },
      });
    });
  }

  // ---------------------------------------------------------------------------
  // BÁO CÁO
  // ---------------------------------------------------------------------------
  console.log(`— Dòng lịch sử cần BỔ SUNG: ${planned.length}`);
  planned.forEach((p) => console.log(`   + user ${short(p.userId)} | ${p.tx.type}/${p.tx.paymentMethod} | ${money(p.tx.amount)}₫ | ${p.why}`));

  console.log(`\n— Bản ghi cũ cần CHUẨN HOÁ nhãn (không đổi số tiền): ${normalizations.length}`);

  console.log(`\n— GIỚI HẠN DỮ LIỆU (KHÔNG dựng lại được, báo cáo thay vì đoán): ${limitations.length}`);
  limitations.forEach((l) => console.log(`   ! ${l}`));

  const missingSnapshots = wallets.reduce(
    (n, w) => n + (w.transactions || []).filter((t) => t.status === 'completed' && typeof t.balanceBefore !== 'number').length,
    0,
  );
  console.log(`\n— Giao dịch 'completed' CŨ không có ảnh chụp số dư: ${missingSnapshots}`);
  console.log('   (Không thể tái dựng: số dư nhiều ví được seed đặt thẳng, tổng nạp − tổng chi không khớp số dư.');
  console.log('    Các dòng này để trống balanceBefore/balanceAfter; giao dịch MỚI từ nay luôn có đủ.)');

  if (!APPLY) {
    console.log('\n>>> CHẠY THỬ — chưa ghi gì. Thêm --apply để ghi thật.\n');
    await mongoose.disconnect();
    return;
  }

  // ---------------------------------------------------------------------------
  // GHI
  // ---------------------------------------------------------------------------
  let added = 0;
  for (const p of planned) {
    const r = await db.collection('familywallets').updateOne(
      { userId: new mongoose.Types.ObjectId(String(p.userId)) },
      { $push: { transactions: p.tx } },
    );
    added += r.modifiedCount;
  }
  let normalized = 0;
  for (const n of normalizations) {
    const r = await db.collection('familywallets').updateOne({ _id: n.walletId }, { $set: n.set });
    normalized += r.modifiedCount;
  }

  console.log(`\n>>> ĐÃ GHI: bổ sung ${added} dòng lịch sử, chuẩn hoá nhãn ${normalized} lượt.`);
  console.log('>>> Số dư ví KHÔNG bị thay đổi bởi script này.\n');

  await mongoose.disconnect();
};

run().then(() => process.exit(0)).catch((e) => {
  console.error('\n✖ LỖI:', e.message);
  process.exit(1);
});
