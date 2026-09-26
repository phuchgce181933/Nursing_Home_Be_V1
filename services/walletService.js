const { Types } = require('mongoose');
const ServiceError = require('./serviceError');
const { apiErr, CODES } = require('../utils/apiError');
const { FamilyWallet } = require('../models');
const paymentService = require('./paymentService');

/**
 * ============================================================================
 *  NGUYÊN TẮC KẾ TOÁN CỦA VÍ
 * ============================================================================
 *
 * 1. Mọi thay đổi số dư PHẢI đi kèm đúng một bản ghi giao dịch thành công, và
 *    hai việc đó phải xảy ra NGUYÊN TỬ.
 *
 * 2. MongoDB local đang chạy STANDALONE (không phải replica set) nên KHÔNG có
 *    transaction đa tài liệu. Bù lại, ví + lịch sử giao dịch nằm trong CÙNG MỘT
 *    document `FamilyWallet`, nên một lệnh `findOneAndUpdate` với aggregation
 *    pipeline đã là nguyên tử tuyệt đối ở cấp document: kiểm tra số dư, trừ/cộng
 *    tiền, ghi giao dịch và chụp balanceBefore/balanceAfter xảy ra trong đúng
 *    một thao tác. Không có khe hở để "trừ tiền nhưng mất giao dịch".
 *
 * 3. Điều kiện `balance: { $gte: amount }` nằm NGAY TRONG bộ lọc, nên hai yêu
 *    cầu đồng thời không thể cùng trừ tiền: yêu cầu thứ hai không khớp filter.
 *
 * 4. balanceBefore/balanceAfter được tính bằng `$balance` NGAY TRONG pipeline,
 *    tức là giá trị thật tại thời điểm ghi — không bao giờ suy ngược từ số dư
 *    hiện tại ở tầng ứng dụng.
 */

const getOrCreateWallet = async (userId) => {
  let wallet = await FamilyWallet.findOne({ userId });
  if (!wallet) {
    wallet = new FamilyWallet({ userId, balance: 0 });
    await wallet.save();
  }
  return wallet;
};

const getWalletBalance = async (user) => {
  const wallet = await getOrCreateWallet(user._id);
  return {
    balance: wallet.balance,
    totalTopup: wallet.totalTopup,
    totalSpent: wallet.totalSpent,
  };
};

const TOPUP_MIN_AMOUNT = 10000;
const TOPUP_MAX_AMOUNT = 500000000;

/** Tiền VND luôn là số nguyên — không bao giờ để số thực lọt vào sổ cái. */
const toMoney = (value) => Math.round(Number(value) || 0);

/**
 * Bọc giá trị bằng $literal trước khi nhét vào aggregation pipeline.
 * Nếu không bọc, một mô tả bắt đầu bằng ký tự "$" sẽ bị MongoDB hiểu nhầm là
 * tham chiếu tới một trường của document.
 */
const lit = (value) => ({ $literal: value === undefined ? null : value });

/** Loại bỏ các khoá không có giá trị để không ghi rác vào document. */
const compact = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null));

/**
 * Cộng tiền vào ví một cách nguyên tử, kèm ảnh chụp số dư.
 * Dùng cho hoàn tiền và các khoản ghi có làm tăng số dư.
 */
const creditWallet = async ({
  userId, amount, type, description, invoiceId, invoiceNumber,
  paymentMethod, reference, paymentId, orderCode, countsAsTopup = false,
}) => {
  const value = toMoney(amount);
  if (value <= 0) throw new ServiceError('Số tiền giao dịch phải lớn hơn 0', 400);

  await getOrCreateWallet(userId);
  const now = new Date();
  const txId = new Types.ObjectId();

  const txDoc = {
    _id: lit(txId),
    type: lit(type),
    direction: lit('credit'),
    paymentMethod: lit(paymentMethod || 'payos'),
    walletAffected: lit(true),
    amount: lit(value),
    balanceBefore: { $ifNull: ['$balance', 0] },
    balanceAfter: { $add: [{ $ifNull: ['$balance', 0] }, value] },
    description: lit(description || ''),
    status: lit('completed'),
    createdAt: lit(now),
    completedAt: lit(now),
    ...compact({
      invoiceId: invoiceId ? lit(new Types.ObjectId(String(invoiceId))) : undefined,
      invoiceNumber: invoiceNumber ? lit(String(invoiceNumber)) : undefined,
      reference: reference ? lit(String(reference)) : undefined,
      paymentId: paymentId ? lit(String(paymentId)) : undefined,
      orderCode: orderCode ? lit(Number(orderCode)) : undefined,
    }),
  };

  const updated = await FamilyWallet.findOneAndUpdate(
    { userId },
    [
      { $set: { transactions: { $concatArrays: [{ $ifNull: ['$transactions', []] }, [txDoc]] } } },
      {
        $set: {
          balance: { $add: [{ $ifNull: ['$balance', 0] }, value] },
          ...(countsAsTopup ? { totalTopup: { $add: [{ $ifNull: ['$totalTopup', 0] }, value] } } : {}),
        },
      },
    ],
    { returnDocument: 'after', updatePipeline: true },
  );

  if (!updated) throw new ServiceError('Không tìm thấy ví của người dùng', 404);
  return { wallet: updated, transactionId: String(txId) };
};

/**
 * Trừ tiền khỏi ví một cách nguyên tử.
 *
 * Bộ lọc yêu cầu `balance >= amount`, nên:
 *  - không đủ số dư  -> không khớp -> KHÔNG trừ đồng nào, ném lỗi nghiệp vụ;
 *  - hai request song song -> chỉ request đầu khớp được, request sau thấy số dư
 *    đã giảm và bị từ chối. Không bao giờ trừ hai lần cho cùng một hoá đơn.
 */
const deductFromWallet = async (userId, amount, description, invoiceId, extra = {}) => {
  const value = toMoney(amount);
  if (value <= 0) throw new ServiceError('Số tiền thanh toán phải lớn hơn 0', 400);

  await getOrCreateWallet(userId);
  const now = new Date();
  const txId = new Types.ObjectId();

  const txDoc = {
    _id: lit(txId),
    type: lit('payment'),
    direction: lit('debit'),
    paymentMethod: lit('wallet'),
    walletAffected: lit(true),
    amount: lit(value),
    balanceBefore: { $ifNull: ['$balance', 0] },
    balanceAfter: { $subtract: [{ $ifNull: ['$balance', 0] }, value] },
    description: lit(description || 'Thanh toán hóa đơn'),
    status: lit('completed'),
    createdAt: lit(now),
    completedAt: lit(now),
    ...compact({
      invoiceId: invoiceId ? lit(new Types.ObjectId(String(invoiceId))) : undefined,
      invoiceNumber: extra.invoiceNumber ? lit(String(extra.invoiceNumber)) : undefined,
      reference: extra.reference ? lit(String(extra.reference)) : undefined,
    }),
  };

  const updated = await FamilyWallet.findOneAndUpdate(
    { userId, balance: { $gte: value } },
    [
      { $set: { transactions: { $concatArrays: [{ $ifNull: ['$transactions', []] }, [txDoc]] } } },
      {
        $set: {
          balance: { $subtract: [{ $ifNull: ['$balance', 0] }, value] },
          totalSpent: { $add: [{ $ifNull: ['$totalSpent', 0] }, value] },
        },
      },
    ],
    { returnDocument: 'after', updatePipeline: true },
  );

  if (!updated) {
    // Không khớp filter = số dư không đủ tại đúng thời điểm trừ tiền.
    throw apiErr(CODES.WALLET_INSUFFICIENT_BALANCE, { statusCode: 400 });
  }

  return { wallet: updated, transactionId: String(txId) };
};

const refundToWallet = async (userId, amount, description, invoiceId, extra = {}) =>
  creditWallet({
    userId,
    amount,
    type: 'refund',
    description: description || 'Hoàn tiền',
    invoiceId,
    invoiceNumber: extra.invoiceNumber,
    paymentMethod: 'wallet',
    reference: extra.reference,
  });

/**
 * Ghi nhận khoản thanh toán hoá đơn trả THẲNG qua PayOS (tiền không vào ví).
 *
 * Bản ghi này bắt buộc phải có để lịch sử tài chính đầy đủ, nhưng
 * `walletAffected=false` và `direction='none'` — tầng hiển thị vì thế KHÔNG
 * được vẽ dấu trừ số dư ví cho nó. Số dư ví hoàn toàn không đổi.
 *
 * Idempotent: đã có bản ghi cùng (orderCode, invoiceId) thì bỏ qua, nên webhook
 * PayOS gửi lại nhiều lần cũng chỉ sinh đúng một dòng lịch sử.
 */
const recordExternalInvoicePayment = async ({ userId, amount, invoiceId, invoiceNumber, orderCode, reference, description }) => {
  const value = toMoney(amount);
  if (!userId || value <= 0) return { created: false, reason: 'missing_user_or_amount' };

  await getOrCreateWallet(userId);
  const now = new Date();
  const txId = new Types.ObjectId();

  const already = await FamilyWallet.findOne({
    userId,
    transactions: {
      $elemMatch: compact({
        type: 'payment',
        walletAffected: false,
        orderCode: orderCode ? Number(orderCode) : undefined,
        invoiceId: invoiceId ? new Types.ObjectId(String(invoiceId)) : undefined,
      }),
    },
  }).select('_id').lean();
  if (already) return { created: false, reason: 'already_recorded' };

  await FamilyWallet.updateOne(
    { userId },
    {
      $push: {
        transactions: compact({
          _id: txId,
          type: 'payment',
          direction: 'none',
          paymentMethod: 'payos',
          walletAffected: false,
          amount: value,
          description:
            description
            || (invoiceNumber ? `Thanh toán hóa đơn ${invoiceNumber} qua PayOS` : 'Thanh toán hóa đơn qua PayOS'),
          invoiceId: invoiceId ? new Types.ObjectId(String(invoiceId)) : undefined,
          invoiceNumber: invoiceNumber || undefined,
          orderCode: orderCode ? Number(orderCode) : undefined,
          reference: reference ? String(reference) : undefined,
          status: 'completed',
          createdAt: now,
          completedAt: now,
        }),
      },
    },
  );

  return { created: true, transactionId: String(txId) };
};

const generateTopupPaymentUrl = async (user, amount, req) => {
  const value = toMoney(amount);
  if (!value || value <= 0) {
    throw new ServiceError('Số tiền nạp phải lớn hơn 0', 400);
  }
  if (value < TOPUP_MIN_AMOUNT) {
    throw new ServiceError(`Số tiền nạp tối thiểu là ${TOPUP_MIN_AMOUNT.toLocaleString('vi-VN')}₫`, 400);
  }
  if (value > TOPUP_MAX_AMOUNT) {
    throw new ServiceError(`Số tiền nạp tối đa là ${TOPUP_MAX_AMOUNT.toLocaleString('vi-VN')}₫`, 400);
  }

  const topupId = `topup_${user._id}_${Date.now()}`;
  const topupInvoice = {
    _id: topupId,
    invoiceNumber: `TOPUP-${Date.now()}`,
    totalAmount: value,
    residentName: 'Nạp Tiền Ví',
    description: `Nạp tiền vào ví - ${value.toLocaleString('vi-VN')}₫`,
  };

  const wallet = await getOrCreateWallet(user._id);
  const payosData = await paymentService.createPayosPaymentRequest({
    invoice: topupInvoice,
    req,
  });

  if (!payosData.checkoutUrl) {
    throw new ServiceError('Không nhận được URL thanh toán từ PayOS', 500);
  }

  // Bản ghi PENDING được tạo NGAY khi khởi tạo checkout — có link thanh toán
  // KHÔNG phải là đã trả tiền, nên tuyệt đối không đặt 'completed' ở đây.
  const existingPending = wallet.transactions.find((tx) => tx.paymentId === topupId);
  if (!existingPending) {
    wallet.transactions.push({
      type: 'topup',
      direction: 'credit',
      paymentMethod: 'payos',
      walletAffected: true,
      amount: value,
      description: 'Nạp tiền vào ví',
      paymentId: topupId,
      orderCode: payosData.orderCode || null,
      paymentLinkId: payosData.paymentLinkId || undefined,
      status: 'pending',
      createdAt: new Date(),
    });
    await wallet.save();
  } else if (!existingPending.orderCode && payosData.orderCode) {
    existingPending.orderCode = payosData.orderCode;
    await wallet.save();
  }

  return {
    checkoutUrl: payosData.checkoutUrl,
    qrCode: payosData.qrCode || null,
    amount: value,
    topupId,
    orderCode: payosData.orderCode || null,
    // Real PayOS bank-transfer details for this specific payment link — used to render
    // a banking-app-style receipt on the client (never fabricated placeholder data).
    bankBin: payosData.bin || null,
    bankAccountNumber: payosData.accountNumber || null,
    bankAccountName: payosData.accountName || null,
    description: payosData.description || null,
    payerName: user.fullName || null,
    createdAt: new Date().toISOString(),
  };
};

/**
 * Chốt một giao dịch nạp tiền đang chờ thành 'completed' và cộng ví — NGUYÊN TỬ
 * và IDEMPOTENT.
 *
 * Bộ lọc bắt buộc giao dịch phải còn `status: 'pending'`; webhook PayOS gửi lại
 * lần hai sẽ không khớp document nào và trả về `alreadyProcessed`, nên KHÔNG
 * thể cộng ví hai lần.
 *
 * Định danh giao dịch phải ỔN ĐỊNH: ưu tiên `orderCode` (PayOS sinh, duy nhất
 * cho từng link thanh toán). Trước đây hệ thống dò theo SỐ TIỀN — hai yêu cầu
 * nạp cùng mệnh giá sẽ bị nhận nhầm lẫn nhau, thậm chí của hai người khác nhau.
 */
const completePendingTopup = async ({ userId, orderCode, paymentId, reference, paymentLinkId }) => {
  if (!orderCode && !paymentId) throw new ServiceError('Thiếu định danh giao dịch nạp tiền', 400);

  const txMatch = compact({
    type: 'topup',
    status: 'pending',
    orderCode: orderCode ? Number(orderCode) : undefined,
    paymentId: paymentId ? String(paymentId) : undefined,
  });

  const matchTxExpr = {
    $and: [
      { $eq: ['$$t.type', 'topup'] },
      { $eq: ['$$t.status', 'pending'] },
      ...(orderCode ? [{ $eq: ['$$t.orderCode', Number(orderCode)] }] : []),
      ...(paymentId ? [{ $eq: ['$$t.paymentId', String(paymentId)] }] : []),
    ],
  };

  const now = new Date();
  const filter = compact({
    userId: userId || undefined,
    transactions: { $elemMatch: txMatch },
  });

  const updated = await FamilyWallet.findOneAndUpdate(
    filter,
    [
      // Chọn ra đúng giao dịch cần chốt.
      { $set: { __tx: { $first: { $filter: { input: '$transactions', as: 't', cond: matchTxExpr } } } } },
      {
        // Ghi trạng thái + ảnh chụp số dư. `$balance` ở đây vẫn là số dư CŨ vì
        // stage kế tiếp mới đổi số dư -> balanceBefore chính xác tuyệt đối.
        $set: {
          transactions: {
            $map: {
              input: '$transactions',
              as: 't',
              in: {
                $cond: [
                  { $eq: ['$$t._id', '$__tx._id'] },
                  {
                    $mergeObjects: [
                      '$$t',
                      compact({
                        status: 'completed',
                        direction: 'credit',
                        paymentMethod: 'payos',
                        walletAffected: true,
                        completedAt: now,
                        reference: reference ? String(reference) : undefined,
                        paymentLinkId: paymentLinkId ? String(paymentLinkId) : undefined,
                      }),
                      {
                        balanceBefore: { $ifNull: ['$balance', 0] },
                        balanceAfter: { $add: [{ $ifNull: ['$balance', 0] }, '$__tx.amount'] },
                      },
                    ],
                  },
                  '$$t',
                ],
              },
            },
          },
        },
      },
      {
        $set: {
          balance: { $add: [{ $ifNull: ['$balance', 0] }, '$__tx.amount'] },
          totalTopup: { $add: [{ $ifNull: ['$totalTopup', 0] }, '$__tx.amount'] },
        },
      },
      { $unset: '__tx' },
    ],
    { returnDocument: 'after', updatePipeline: true },
  );

  if (!updated) {
    // Không khớp: hoặc chưa từng có giao dịch này, hoặc nó ĐÃ được xử lý rồi.
    const already = await FamilyWallet.findOne(
      compact({
        userId: userId || undefined,
        transactions: {
          $elemMatch: compact({
            type: 'topup',
            status: 'completed',
            orderCode: orderCode ? Number(orderCode) : undefined,
            paymentId: paymentId ? String(paymentId) : undefined,
          }),
        },
      }),
    );
    if (already) return { wallet: already, alreadyProcessed: true };
    return { wallet: null, alreadyProcessed: false, notFound: true };
  }

  return { wallet: updated, alreadyProcessed: false };
};

/** Đánh dấu một giao dịch nạp tiền đang chờ là thất bại/huỷ. KHÔNG đụng số dư. */
const failPendingTopup = async ({ userId, orderCode, paymentId, failureReason }) => {
  const txMatch = compact({
    type: 'topup',
    status: 'pending',
    orderCode: orderCode ? Number(orderCode) : undefined,
    paymentId: paymentId ? String(paymentId) : undefined,
  });
  await FamilyWallet.updateOne(
    compact({ userId: userId || undefined, transactions: { $elemMatch: txMatch } }),
    {
      $set: compact({
        'transactions.$.status': 'failed',
        'transactions.$.completedAt': new Date(),
        'transactions.$.failureReason': failureReason || undefined,
      }),
    },
  );
};

const confirmTopup = async (userId, topupId) => {
  const result = await completePendingTopup({ userId, paymentId: topupId });
  if (result.notFound) throw new ServiceError('Yêu cầu nạp tiền không tồn tại', 404);
  return result.wallet;
};

const confirmTopupByTopupId = async (topupId) => {
  const parts = String(topupId).split('_');
  if (parts.length < 3) {
    throw new ServiceError('Định dạng topupId không hợp lệ', 400);
  }
  return confirmTopup(parts[1], topupId);
};

/**
 * Hỏi thẳng PayOS trạng thái thật rồi mới cộng ví. Dùng cho luồng "quay lại app"
 * và polling — không bao giờ tin query string của trình duyệt.
 */
const verifyAndConfirmTopup = async (userId, topupId) => {
  const wallet = await getOrCreateWallet(userId);
  const tx = wallet.transactions.find((t) => t.paymentId === topupId && t.type === 'topup');

  if (!tx) throw new ServiceError('Yêu cầu nạp tiền không tồn tại', 404);

  if (tx.status === 'completed') {
    return {
      status: 'PAID',
      wallet: { balance: wallet.balance, totalTopup: wallet.totalTopup, totalSpent: wallet.totalSpent },
    };
  }

  if (!tx.orderCode) {
    // Không có orderCode thì không thể đối chiếu với PayOS — giữ nguyên chờ xử lý.
    return { status: 'PENDING' };
  }

  let paymentData;
  try {
    paymentData = await paymentService.getPayosPaymentStatus(tx.orderCode);
  } catch (err) {
    console.warn('[verifyAndConfirmTopup] PayOS API error:', err.message);
    return { status: 'PENDING' };
  }

  const payosStatus = String(paymentData.status || 'PENDING').toUpperCase();

  if (payosStatus === 'PAID') {
    const result = await completePendingTopup({
      userId,
      orderCode: tx.orderCode,
      reference: paymentData?.transactions?.[0]?.reference,
      paymentLinkId: paymentData?.id,
    });
    const w = result.wallet || (await getOrCreateWallet(userId));
    return {
      status: 'PAID',
      wallet: { balance: w.balance, totalTopup: w.totalTopup, totalSpent: w.totalSpent },
    };
  }

  if (payosStatus === 'CANCELLED' || payosStatus === 'EXPIRED') {
    await failPendingTopup({
      userId,
      orderCode: tx.orderCode,
      failureReason: payosStatus === 'CANCELLED' ? 'Người dùng đã huỷ thanh toán' : 'Link thanh toán đã hết hạn',
    });
    return { status: payosStatus };
  }

  return { status: 'PENDING' };
};

/**
 * Chuẩn hoá một dòng sổ cái trước khi trả ra API.
 *
 * Bản ghi CŨ có thể thiếu `direction`/`paymentMethod`/ảnh chụp số dư. Những gì
 * suy ra được an toàn từ `type` thì suy; còn số dư trước/sau thì TUYỆT ĐỐI
 * không bịa — chỉ gắn cờ `hasBalanceSnapshot=false` để giao diện tự ẩn đi.
 */
const presentTransaction = (tx) => {
  const plain = typeof tx.toObject === 'function' ? tx.toObject() : tx;
  const walletAffected = plain.walletAffected !== false;
  return {
    ...plain,
    _id: String(plain._id),
    invoiceId: plain.invoiceId ? String(plain.invoiceId) : undefined,
    walletAffected,
    direction: plain.direction || (plain.type === 'payment' ? 'debit' : 'credit'),
    paymentMethod: plain.paymentMethod || (plain.type === 'payment' && walletAffected ? 'wallet' : 'payos'),
    hasBalanceSnapshot:
      typeof plain.balanceBefore === 'number' && typeof plain.balanceAfter === 'number',
  };
};

/**
 * LỊCH SỬ GIAO DỊCH HỢP NHẤT của CHÍNH người dùng đang đăng nhập.
 *
 * Phạm vi luôn lấy từ `req.user._id` ở tầng controller — không bao giờ nhận
 * userId do client gửi lên, nên gia đình A không thể xem sổ của gia đình B.
 */
const listTransactions = async (user, query = {}) => {
  const wallet = await getOrCreateWallet(user._id);

  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));

  let items = (wallet.transactions || []).map(presentTransaction);

  if (query.type) {
    const wanted = String(query.type).split(',').map((s) => s.trim()).filter(Boolean);
    items = items.filter((tx) => wanted.includes(tx.type));
  }
  if (query.status) {
    const wanted = String(query.status).split(',').map((s) => s.trim()).filter(Boolean);
    items = items.filter((tx) => wanted.includes(tx.status));
  }
  // Lọc theo hướng dòng tiền (đã được presentTransaction chuẩn hoá): credit = tiền vào
  // (nạp/hoàn), debit = tiền ra (thanh toán bằng ví). Thanh toán PayOS trực tiếp mang
  // direction 'none' nên KHÔNG lọt vào credit/debit — chỉ hiện khi không lọc (Tất cả).
  if (query.direction) {
    const wanted = String(query.direction).split(',').map((s) => s.trim()).filter(Boolean);
    items = items.filter((tx) => wanted.includes(tx.direction));
  }

  items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const total = items.length;
  const data = items.slice((page - 1) * limit, page * limit);

  return {
    data,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
    summary: {
      balance: wallet.balance,
      totalTopup: wallet.totalTopup,
      totalSpent: wallet.totalSpent,
    },
  };
};

const getTransactionById = async (user, transactionId) => {
  const wallet = await getOrCreateWallet(user._id);
  const tx = (wallet.transactions || []).find((t) => String(t._id) === String(transactionId));
  if (!tx) throw new ServiceError('Không tìm thấy giao dịch', 404);
  return presentTransaction(tx);
};

module.exports = {
  getOrCreateWallet,
  getWalletBalance,
  generateTopupPaymentUrl,
  confirmTopup,
  confirmTopupByTopupId,
  completePendingTopup,
  failPendingTopup,
  verifyAndConfirmTopup,
  creditWallet,
  deductFromWallet,
  refundToWallet,
  recordExternalInvoicePayment,
  listTransactions,
  getTransactionById,
};
