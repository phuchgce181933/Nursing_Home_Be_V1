const ServiceError = require('./serviceError');
const { FamilyWallet } = require('../models');
const paymentService = require('./paymentService');
const { createAuditLog } = require('../utils/auditLog');

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

const generateTopupPaymentUrl = async (user, amount, req) => {
  if (!amount || amount <= 0) {
    throw new ServiceError('Số tiền nạp phải lớn hơn 0', 400);
  }
  if (amount < TOPUP_MIN_AMOUNT) {
    throw new ServiceError(`Số tiền nạp tối thiểu là ${TOPUP_MIN_AMOUNT.toLocaleString('vi-VN')}₫`, 400);
  }
  if (amount > TOPUP_MAX_AMOUNT) {
    throw new ServiceError(`Số tiền nạp tối đa là ${TOPUP_MAX_AMOUNT.toLocaleString('vi-VN')}₫`, 400);
  }

  const topupId = `topup_${user._id}_${Date.now()}`;
  const topupData = {
    _id: topupId,
    invoiceNumber: `TOPUP-${Date.now()}`,
    amount: amount,
  };

  const topupInvoice = {
    _id: topupData._id,
    invoiceNumber: topupData.invoiceNumber,
    totalAmount: amount,
    residentName: 'Nạp Tiền Ví',
    description: `Nạp tiền vào ví - ${amount.toLocaleString('vi-VN')}₫`,
  };

  const wallet = await getOrCreateWallet(user._id);
  const payosData = await paymentService.createPayosPaymentRequest({
    invoice: topupInvoice,
    req,
  });

  if (!payosData.checkoutUrl) {
    throw new ServiceError('Không nhận được URL thanh toán từ PayOS', 500);
  }

  // Store transaction AFTER getting orderCode from PayOS so we can verify later
  const existingPending = wallet.transactions.find((tx) => tx.paymentId === topupId);
  if (!existingPending) {
    wallet.transactions.push({
      type: 'topup',
      amount,
      description: 'Nạp tiền vào ví',
      paymentId: topupId,
      orderCode: payosData.orderCode || null,
      status: 'pending',
      createdAt: new Date(),
    });
    await wallet.save();
  } else if (!existingPending.orderCode && payosData.orderCode) {
    existingPending.orderCode = payosData.orderCode;
    await wallet.save();
  }

  await createAuditLog({
    actorUserId: user._id,
    actorRole: user.role || 'family',
    action: 'CREATE_WALLET_TOPUP',
    displayAction: 'Tạo giao dịch nạp ví',
    module: 'wallet',
    businessModule: 'wallet',
    targetEntityType: 'WalletTransaction',
    targetEntityId: topupId,
    targetName: `Nạp ${amount.toLocaleString('vi-VN')}₫ vào ví`,
    description: `${user.fullName || user.email || 'Người dùng'} đã tạo yêu cầu nạp ${amount.toLocaleString('vi-VN')}₫ vào ví`,
    beforeData: { balance: wallet.balance - 0 },
    afterData: { pendingTopupAmount: amount, orderCode: payosData.orderCode || null },
    metadata: { amount, orderCode: payosData.orderCode || null, status: 'pending' },
    req,
  });

  return {
    checkoutUrl: payosData.checkoutUrl,
    qrCode: payosData.qrCode || null,
    amount,
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

const confirmTopup = async (userId, topupId, paymentId, actor = null, req = null) => {
  const wallet = await getOrCreateWallet(userId);
  const transaction = wallet.transactions.find((tx) => tx.paymentId === topupId && tx.type === 'topup');

  if (!transaction) {
    throw new ServiceError('Yêu cầu nạp tiền không tồn tại', 404);
  }

  if (transaction.status === 'completed') {
    return wallet;
  }

  const previousBalance = wallet.balance;
  transaction.status = 'completed';
  transaction.paymentId = paymentId || transaction.paymentId || topupId;

  wallet.balance += transaction.amount;
  wallet.totalTopup += transaction.amount;

  await wallet.save();

  await createAuditLog({
    actorUserId: actor?._id || userId,
    actorRole: actor?.role || 'family',
    action: 'CONFIRM_WALLET_TOPUP',
    displayAction: 'Xác nhận nạp tiền vào ví',
    module: 'wallet',
    businessModule: 'wallet',
    targetEntityType: 'WalletTransaction',
    targetEntityId: topupId,
    targetName: `Nạp ${transaction.amount.toLocaleString('vi-VN')}₫ vào ví`,
    description: actor
      ? `${actor.fullName || actor.email || 'Hệ thống'} đã xác nhận nạp ${transaction.amount.toLocaleString('vi-VN')}₫ vào ví`
      : `Hệ thống đã xác nhận nạp ${transaction.amount.toLocaleString('vi-VN')}₫ vào ví`,
    beforeData: { balance: previousBalance, status: 'pending' },
    afterData: { balance: wallet.balance, status: 'completed' },
    metadata: { amount: transaction.amount, paymentId, source: actor ? 'admin' : 'system-webhook' },
    req,
  });

  return wallet;
};

const confirmTopupByTopupId = async (topupId, paymentId) => {
  const parts = String(topupId).split('_');
  if (parts.length < 3) {
    throw new ServiceError('Định dạng topupId không hợp lệ', 400);
  }
  const userId = parts[1];
  return confirmTopup(userId, topupId, paymentId);
};

// Poll-based verification: check real payment status with PayOS API and auto-confirm if paid
const verifyAndConfirmTopup = async (userId, topupId) => {
  const wallet = await getOrCreateWallet(userId);
  const tx = wallet.transactions.find((t) => t.paymentId === topupId && t.type === 'topup');

  if (!tx) throw new ServiceError('Yêu cầu nạp tiền không tồn tại', 404);

  // Already confirmed
  if (tx.status === 'completed') {
    return {
      status: 'PAID',
      wallet: { balance: wallet.balance, totalTopup: wallet.totalTopup, totalSpent: wallet.totalSpent },
    };
  }

  if (!tx.orderCode) {
    // No orderCode stored — cannot verify with PayOS; return pending
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
    const previousBalance = wallet.balance;
    tx.status = 'completed';
    wallet.balance += tx.amount;
    wallet.totalTopup += tx.amount;
    await wallet.save();
    await createAuditLog({
      actorUserId: null,
      actorRole: 'system',
      action: 'VERIFY_WALLET_TOPUP',
      displayAction: 'Xác minh & xác nhận nạp tiền',
      module: 'wallet',
      businessModule: 'wallet',
      targetEntityType: 'WalletTransaction',
      targetEntityId: topupId,
      targetName: `Nạp ${tx.amount.toLocaleString('vi-VN')}₫ vào ví`,
      description: `Hệ thống đã xác minh với PayOS và xác nhận nạp ${tx.amount.toLocaleString('vi-VN')}₫ vào ví`,
      beforeData: { balance: previousBalance, status: 'pending' },
      afterData: { balance: wallet.balance, status: 'completed' },
      metadata: { amount: tx.amount, orderCode: tx.orderCode, source: 'payos-api-verify' },
    });
    return {
      status: 'PAID',
      wallet: { balance: wallet.balance, totalTopup: wallet.totalTopup, totalSpent: wallet.totalSpent },
    };
  }

  if (payosStatus === 'CANCELLED' || payosStatus === 'EXPIRED') {
    tx.status = 'failed';
    await wallet.save();
    return { status: payosStatus };
  }

  return { status: 'PENDING' };
};

// Used by PayOS webhook: find the most-recent pending topup for this amount across all wallets
const confirmPendingTopupByAmount = async (amount, paymentId, userId) => {
  const walletQuery = {
    transactions: {
      $elemMatch: { type: 'topup', amount, status: 'pending' },
    },
  };
  if (userId) walletQuery.userId = userId;
  const wallet = await FamilyWallet.findOne(walletQuery).sort({ updatedAt: -1 });

  if (!wallet) {
    throw new ServiceError('Không tìm thấy giao dịch nạp tiền chờ xác nhận', 404);
  }

  const tx = wallet.transactions
    .filter((t) => t.type === 'topup' && t.amount === amount && t.status === 'pending')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];

  if (!tx) {
    throw new ServiceError('Không tìm thấy giao dịch nạp tiền chờ xác nhận', 404);
  }

  if (tx.status === 'completed') return wallet;

  const previousBalance = wallet.balance;
  tx.status = 'completed';
  if (paymentId) tx.paymentId = paymentId;
  wallet.balance += tx.amount;
  wallet.totalTopup += tx.amount;

  await wallet.save();

  await createAuditLog({
    actorUserId: userId || null,
    actorRole: 'family',
    action: 'CONFIRM_PENDING_TOPUP',
    displayAction: 'Xác nhận giao dịch nạp tiền pending',
    module: 'wallet',
    businessModule: 'wallet',
    targetEntityType: 'WalletTransaction',
    targetEntityId: tx.paymentId,
    targetName: `Nạp ${tx.amount.toLocaleString('vi-VN')}₫ vào ví`,
    description: `Hệ thống đã xác nhận giao dịch nạp ${tx.amount.toLocaleString('vi-VN')}₫ (fallback theo số tiền)`,
    beforeData: { balance: previousBalance, status: 'pending' },
    afterData: { balance: wallet.balance, status: 'completed' },
    metadata: { amount: tx.amount, paymentId, source: 'payos-webhook-fallback' },
  });

  return wallet;
};

const deductFromWallet = async (userId, amount, description, invoiceId) => {
  const wallet = await getOrCreateWallet(userId);
  
  if (wallet.balance < amount) {
    throw new ServiceError('Số dư ví không đủ', 400);
  }

  // Add transaction
  wallet.transactions.push({
    type: 'payment',
    amount,
    description: description || 'Thanh toán hóa đơn',
    invoiceId,
    status: 'completed',
  });

  // Update balance and total spent
  wallet.balance -= amount;
  wallet.totalSpent += amount;

  await wallet.save();

  await createAuditLog({
    actorUserId: userId,
    actorRole: 'family',
    action: 'DEDUCT_WALLET',
    displayAction: 'Trừ tiền ví thanh toán hóa đơn',
    module: 'wallet',
    businessModule: 'wallet',
    targetEntityType: 'WalletTransaction',
    targetEntityId: invoiceId || 'wallet-deduct',
    targetName: `Thanh toán ${amount.toLocaleString('vi-VN')}₫`,
    description: `Trừ ${amount.toLocaleString('vi-VN')}₫ từ ví để thanh toán hóa đơn${invoiceId ? ` ${invoiceId}` : ''}`,
    beforeData: { balance: wallet.balance + amount },
    afterData: { balance: wallet.balance, status: 'completed' },
    metadata: { amount, type: 'payment', invoiceId, description },
  });

  return wallet;
};

const refundToWallet = async (userId, amount, description, invoiceId) => {
  const wallet = await getOrCreateWallet(userId);

  wallet.transactions.push({
    type: 'refund',
    amount,
    description: description || 'Hoàn tiền',
    invoiceId,
    status: 'completed',
  });

  wallet.balance += amount;

  await wallet.save();

  await createAuditLog({
    actorUserId: userId,
    actorRole: 'family',
    action: 'REFUND_WALLET',
    displayAction: 'Hoàn tiền vào ví',
    module: 'wallet',
    businessModule: 'wallet',
    targetEntityType: 'WalletTransaction',
    targetEntityId: invoiceId || 'wallet-refund',
    targetName: `Hoàn ${amount.toLocaleString('vi-VN')}₫`,
    description: `Hoàn ${amount.toLocaleString('vi-VN')}₫ vào ví${invoiceId ? ` cho hóa đơn ${invoiceId}` : ''}`,
    beforeData: { balance: wallet.balance - amount },
    afterData: { balance: wallet.balance, status: 'completed' },
    metadata: { amount, type: 'refund', invoiceId, description },
  });

  return wallet;
};

module.exports = {
  getOrCreateWallet,
  getWalletBalance,
  generateTopupPaymentUrl,
  confirmTopup,
  confirmTopupByTopupId,
  confirmPendingTopupByAmount,
  verifyAndConfirmTopup,
  deductFromWallet,
  refundToWallet,
};
