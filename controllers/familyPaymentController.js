const otpService = require('../services/otpService');
const walletService = require('../services/walletService');
const paymentService = require('../services/paymentService');
const { apiErr, CODES } = require('../utils/apiError');

/** Trần số hoá đơn cho một lần xác thực, tránh một OTP "ôm" một khoản tiền quá lớn. */
const MAX_INVOICES_PER_PAYMENT = 20;

/** Trạng thái hoá đơn còn có thể thanh toán. */
const PAYABLE_STATUSES = ['DRAFT', 'ISSUED', 'OVERDUE', 'PARTIALLY_PAID'];

const toMoney = (value) => Math.round(Number(value) || 0);

/**
 * Nạp danh sách hoá đơn và kiểm tra TOÀN BỘ điều kiện trước khi đụng tới tiền.
 * `paymentService.findInvoiceById` đã tự kiểm tra quyền sở hữu (assertInvoiceAccess),
 * nên người nhà không thể trả hộ / thao tác lên hoá đơn của gia đình khác.
 */
const loadPayableInvoices = async (user, invoiceIds) => {
  if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
    throw apiErr(CODES.WALLET_PAYMENT_INVOICE_REQUIRED, { statusCode: 400 });
  }
  if (invoiceIds.length > MAX_INVOICES_PER_PAYMENT) {
    throw apiErr(CODES.WALLET_PAYMENT_TOO_MANY_INVOICES, {
      statusCode: 400,
      params: { max: MAX_INVOICES_PER_PAYMENT },
    });
  }

  const unique = [...new Set(invoiceIds.map(String))];
  const invoices = [];
  for (const id of unique) {
    const invoice = await paymentService.findInvoiceById(user, id);
    if (invoice.status === 'PAID') throw apiErr(CODES.INVOICE_ALREADY_PAID, { statusCode: 409 });
    if (!PAYABLE_STATUSES.includes(invoice.status)) {
      throw apiErr(CODES.INVOICE_NOT_PAYABLE, { statusCode: 409 });
    }
    invoices.push(invoice);
  }
  return invoices;
};

const sumInvoices = (invoices) => invoices.reduce((sum, inv) => sum + toMoney(inv.totalAmount), 0);

// POST /api/family/wallet/payments/initiate
const initiateWalletPayment = async (req, res, next) => {
  try {
    const { amount, invoiceIds } = req.body;

    // 1) Quyền sở hữu + trạng thái hoá đơn.
    const invoices = await loadPayableInvoices(req.user, invoiceIds);

    // 2) Số tiền do SERVER tính từ hoá đơn, không tin số client gửi lên.
    //    Client vẫn được gửi `amount` nhưng chỉ để đối chiếu.
    const serverAmount = sumInvoices(invoices);
    if (serverAmount <= 0) throw apiErr(CODES.WALLET_PAYMENT_AMOUNT_INVALID, { statusCode: 400 });
    if (amount !== undefined && amount !== null && toMoney(amount) !== serverAmount) {
      throw apiErr(CODES.WALLET_PAYMENT_AMOUNT_MISMATCH, { statusCode: 400 });
    }

    // 3) Kiểm tra số dư TRƯỚC khi tốn một tin nhắn SMS cho giao dịch chắc chắn hỏng.
    const wallet = await walletService.getOrCreateWallet(req.user._id);
    if (wallet.balance < serverAmount) {
      throw apiErr(CODES.WALLET_INSUFFICIENT_BALANCE, { statusCode: 400 });
    }

    // 4) Số điện thoại lấy từ hồ sơ người dùng đã đăng nhập, không nhận từ client.
    const phone = String(req.user.phone || '').trim();
    if (!phone) throw apiErr(CODES.OTP_PHONE_MISSING, { statusCode: 400 });

    // `meta` chốt cứng ý định thanh toán vào chính mã OTP: một mã chỉ trả được
    // đúng những hoá đơn này với đúng số tiền này.
    const result = await otpService.createOtp({
      userId: req.user._id,
      phone,
      purpose: 'wallet_payment',
      meta: { amount: serverAmount, invoiceIds: invoices.map((inv) => String(inv._id)) },
    });

    return res.json({ success: true, data: { ...result, amount: serverAmount } });
  } catch (error) {
    return next(error);
  }
};

/**
 * Trả một hoá đơn: trừ ví -> ghi nhận thanh toán -> cập nhật trạng thái hoá đơn.
 *
 * Idempotency: `transactionRef` suy ra từ otpId (đã dùng một lần duy nhất) nên
 * lần chạy lại cùng một OTP không thể tạo Payment thứ hai — `recordPayment` chặn
 * trùng `transactionRef`. Nếu bước ghi nhận thất bại thì HOÀN LẠI đúng số tiền
 * vừa trừ, để ví không bao giờ mất tiền mà hoá đơn vẫn chưa được trả.
 */
const payOneInvoice = async (user, invoice, amount, transactionRef) => {
  const invoiceId = String(invoice._id);
  const label = invoice.invoiceNumber ? `Thanh toán hóa đơn ${invoice.invoiceNumber}` : 'Thanh toán hóa đơn';

  await walletService.deductFromWallet(user._id, amount, label, invoiceId);
  try {
    return await paymentService.recordPayment(user, invoiceId, {
      paymentMethod: 'wallet',
      amount,
      transactionRef,
      note: label,
    });
  } catch (err) {
    await walletService
      .refundToWallet(user._id, amount, `Hoàn tiền do thanh toán thất bại: ${label}`, invoiceId)
      .catch((refundErr) => {
        console.error('[walletPayment] HOÀN TIỀN THẤT BẠI', { invoiceId, amount, error: refundErr?.message });
      });
    throw err;
  }
};

// POST /api/family/wallet/payments/verify
const verifyWalletPayment = async (req, res, next) => {
  try {
    const { otpId, code } = req.body;
    if (!otpId || !code) throw apiErr(CODES.OTP_NOT_FOUND, { statusCode: 400 });

    // 1) Xác thực OTP. Bước này tiêu thụ mã một cách nguyên tử: hai request cùng
    //    lúc thì chỉ một request đi tiếp được, request kia dừng tại đây.
    const { meta, otpId: consumedOtpId } = await otpService.verifyOtp({
      userId: req.user._id,
      otpId,
      code,
      purpose: 'wallet_payment',
    });

    // 2) Kiểm tra lại từ đầu bằng dữ liệu hiện tại — hoá đơn có thể đã được trả
    //    bằng PayOS trong lúc người dùng còn đang nhập mã.
    const invoices = await loadPayableInvoices(req.user, meta?.invoiceIds);
    const serverAmount = sumInvoices(invoices);
    if (serverAmount <= 0) throw apiErr(CODES.WALLET_PAYMENT_AMOUNT_INVALID, { statusCode: 400 });
    if (toMoney(meta?.amount) !== serverAmount) {
      throw apiErr(CODES.WALLET_PAYMENT_AMOUNT_MISMATCH, { statusCode: 400 });
    }

    // 3) Kiểm tra số dư cho TOÀN BỘ đợt trước khi trừ đồng nào.
    const wallet = await walletService.getOrCreateWallet(req.user._id);
    if (wallet.balance < serverAmount) {
      throw apiErr(CODES.WALLET_INSUFFICIENT_BALANCE, { statusCode: 400 });
    }

    // 4) Trừ ví + ghi nhận thanh toán, từng hoá đơn một.
    const payments = [];
    for (let i = 0; i < invoices.length; i += 1) {
      const invoice = invoices[i];
      const transactionRef = `WALLET-OTP-${consumedOtpId}-${i}`;
      payments.push(await payOneInvoice(req.user, invoice, toMoney(invoice.totalAmount), transactionRef));
    }

    const balance = (await walletService.getWalletBalance(req.user)).balance;

    return res.status(201).json({
      success: true,
      data: {
        amount: serverAmount,
        invoiceIds: invoices.map((inv) => String(inv._id)),
        payments,
        walletBalance: balance,
        // Tương thích ngược với client cũ vốn đọc thẳng object payment đơn lẻ.
        ...(payments.length === 1 ? { payment: payments[0] } : {}),
      },
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  initiateWalletPayment,
  verifyWalletPayment,
};
