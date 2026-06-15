const ServiceError = require('./serviceError');
const { FamilyWallet } = require('../models');
const paymentService = require('./paymentService');

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

const generateTopupPaymentUrl = async (user, amount, req) => {
  if (!amount || amount <= 0) {
    throw new ServiceError('Số tiền nạp phải lớn hơn 0', 400);
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
  const existingPending = wallet.transactions.find((tx) => tx.paymentId === topupId);
  if (!existingPending) {
    wallet.transactions.push({
      type: 'topup',
      amount,
      description: 'Nạp tiền vào ví',
      paymentId: topupId,
      status: 'pending',
      createdAt: new Date(),
    });
    await wallet.save();
  }

  const payosData = await paymentService.createPayosPaymentRequest({
    invoice: topupInvoice,
    req,
  });

  console.log('[Wallet Topup] PayOS Response:', JSON.stringify({
    hasCheckoutUrl: !!payosData.checkoutUrl,
    checkoutUrl: payosData.checkoutUrl,
    payosDataKeys: Object.keys(payosData),
  }));

  if (!payosData.checkoutUrl) {
    throw new ServiceError('Không nhận được URL thanh toán từ PayOS', 500);
  }

  return {
    checkoutUrl: payosData.checkoutUrl,
    amount: amount,
    topupId,
  };
};

const confirmTopup = async (userId, topupId, paymentId) => {
  const wallet = await getOrCreateWallet(userId);
  const transaction = wallet.transactions.find((tx) => tx.paymentId === topupId && tx.type === 'topup');

  if (!transaction) {
    throw new ServiceError('Yêu cầu nạp tiền không tồn tại', 404);
  }

  if (transaction.status === 'completed') {
    return wallet;
  }

  transaction.status = 'completed';
  transaction.paymentId = paymentId || transaction.paymentId || topupId;

  wallet.balance += transaction.amount;
  wallet.totalTopup += transaction.amount;

  await wallet.save();
  return wallet;
};

const confirmTopupByTopupId = async (topupId, paymentId) => {
  const parts = String(topupId).split('_');
  if (parts.length < 3) {
    throw new ServiceError('Invalid topupId format', 400);
  }
  const userId = parts[1];
  return confirmTopup(userId, topupId, paymentId);
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
  return wallet;
};

module.exports = {
  getOrCreateWallet,
  getWalletBalance,
  generateTopupPaymentUrl,
  confirmTopup,
  deductFromWallet,
  refundToWallet,
};
