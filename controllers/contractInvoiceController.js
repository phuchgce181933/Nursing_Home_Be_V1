const contractInvoiceService = require('../services/contractInvoiceService');
const Invoice = require('../models/invoice');
const Resident = require('../models/resident');
const Contract = require('../models/contract');
const User = require('../models/user');

/**
 * UC-128: Create Invoice from Contract
 * POST /api/admin/contracts/:contractId/create-invoice
 *
 * Flow: Doctor khám → Tạo Hợp đồng → Tạo Hóa đơn (current step)
 */
const createInvoiceFromContract = async (req, res) => {
  try {
    const result = await contractInvoiceService.createInvoiceFromContract(
      req.user,
      req.params.contractId,
      req.body,
      req
    );
    res.status(201).json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message, errorCode: err.errorCode });
  }
};

// ════════════════════════════════════════════════════════════════════════
// Export Invoice (HTML có thể in ra PDF)
// ════════════════════════════════════════════════════════════════════════

const STATUS_LABELS_VI = {
  DRAFT: 'Nháp',
  ISSUED: 'Đã xuất',
  PARTIALLY_PAID: 'Thanh toán một phần',
  PAID: 'Đã thanh toán',
  CANCELLED: 'Đã hủy',
};

const TYPE_LABELS_VI = {
  SERVICE: 'Dịch vụ',
  MEDICATION: 'Thuốc',
  OTHER: 'Khác',
  COMBINED: 'Kết hợp',
};

const escapeHtml = (value) => {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const formatVnd = (n) => {
  const num = Number(n || 0);
  return `${num.toLocaleString('vi-VN')} VND`;
};

const formatDate = (d) => {
  if (!d) return '—';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('vi-VN');
};

/**
 * Xuất hóa đơn ra HTML có thể lưu về máy hoặc in ra PDF.
 * GET /api/admin/contracts/invoices/:invoiceId/export
 *
 * Trả về file HTML self-contained, không phụ thuộc asset ngoài, có nút "In / Lưu PDF"
 * trên trang để người dùng mở hộp thoại in của trình duyệt.
 */
const exportInvoiceHtml = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.invoiceId)
      .populate({
        path: 'residentId',
        select: 'fullName dateOfBirth gender phone address code',
      })
      .populate({
        path: 'contractId',
        select: 'contractNumber startDate endDate monthlyFee discountPercent durationMonths',
      })
      .populate({
        path: 'familyAccountId',
        select: 'fullName email phone',
      })
      .lean();

    if (!invoice) {
      return res.status(404).json({ message: 'Không tìm thấy hóa đơn' });
    }

    // Build extra display info
    const resident = invoice.residentId || {};
    const contract = invoice.contractId || {};
    const family = invoice.familyAccountId || null;

    const statusKey = String(invoice.status || 'DRAFT').toUpperCase();
    const typeKey = String(invoice.type || 'COMBINED').toUpperCase();
    const statusLabel = STATUS_LABELS_VI[statusKey] || statusKey;
    const typeLabel = TYPE_LABELS_VI[typeKey] || typeKey;

    const billingStart = invoice.billingPeriodStart || invoice.periodStart || contract.startDate;
    const billingEnd = invoice.billingPeriodEnd || invoice.periodEnd || contract.endDate;
    // Hạn thanh toán: mặc định = ngày bắt đầu kỳ thanh toán + 5 ngày.
    // Ưu tiên invoice.dueDate (do issueInvoices set), fallback theo billingStart.
    const issueDate = invoice.issuedAt || invoice.createdAt || new Date();
    const billingStartDate = billingStart ? new Date(billingStart) : issueDate;
    const dueDate =
      invoice.dueDate ||
      new Date(billingStartDate.getTime() + 5 * 24 * 60 * 60 * 1000);

    const totalAmount = Number(invoice.totalAmount ?? invoice.total ?? 0);
    const tax = Number(invoice.tax ?? 0);
    // Tạm tính = tổng cộng trừ thuế (không phụ thuộc subTotal từ DB, vì
    // hóa đơn tổng hợp theo hợp đồng có thể không có items[]).
    const subTotalExclTax = Math.max(totalAmount - tax, 0);
    const remaining = Number(invoice.remainingAmount ?? totalAmount);
    const paid = Math.max(totalAmount - remaining, 0);

    // Các thành phần phí (nếu có)
    const hasBreakdown =
      Number(invoice.careServiceCost || 0) > 0 ||
      Number(invoice.roomCost || 0) > 0 ||
      Number(invoice.medicationCost || 0) > 0 ||
      Number(invoice.otherCost || 0) > 0;

    const breakdownRows = hasBreakdown
      ? `
          <table style="width:100%; border-collapse:collapse; margin-top:8px;">
            <thead>
              <tr>
                <th style="text-align:left; padding:6px; border-bottom:1px solid #e2e8f0;">Thành phần</th>
                <th style="text-align:right; padding:6px; border-bottom:1px solid #e2e8f0;">Số tiền</th>
              </tr>
            </thead>
            <tbody>
              ${Number(invoice.careServiceCost || 0) > 0 ? `<tr><td style="padding:6px;">Phí dịch vụ chăm sóc</td><td style="padding:6px; text-align:right;">${formatVnd(invoice.careServiceCost)}</td></tr>` : ''}
              ${Number(invoice.roomCost || 0) > 0 ? `<tr><td style="padding:6px;">Phí phòng</td><td style="padding:6px; text-align:right;">${formatVnd(invoice.roomCost)}</td></tr>` : ''}
              ${Number(invoice.medicationCost || 0) > 0 ? `<tr><td style="padding:6px;">Phí thuốc</td><td style="padding:6px; text-align:right;">${formatVnd(invoice.medicationCost)}</td></tr>` : ''}
              ${Number(invoice.otherCost || 0) > 0 ? `<tr><td style="padding:6px;">Phí khác</td><td style="padding:6px; text-align:right;">${formatVnd(invoice.otherCost)}</td></tr>` : ''}
            </tbody>
          </table>`
      : '';

    const html = `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<title>Hóa đơn ${escapeHtml(invoice.invoiceNumber || invoice._id.toString())}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; color: #0f172a; margin: 0; padding: 32px; background: #f8fafc; }
  .sheet { max-width: 820px; margin: 0 auto; background: #fff; padding: 32px 40px; border-radius: 12px; box-shadow: 0 4px 20px rgba(15,23,42,0.08); }
  .actions { max-width: 820px; margin: 0 auto 16px; display: flex; justify-content: flex-end; gap: 8px; }
  .btn { padding: 8px 16px; border-radius: 6px; font-weight: 600; font-size: 0.9rem; cursor: pointer; border: none; }
  .btn-primary { background: #2563eb; color: #fff; }
  .btn-secondary { background: #e2e8f0; color: #0f172a; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f172a; padding-bottom: 16px; margin-bottom: 20px; }
  .header h1 { margin: 0; font-size: 1.6rem; }
  .header .meta { text-align: right; font-size: 0.9rem; line-height: 1.5; }
  .badge { display: inline-block; padding: 4px 12px; border-radius: 999px; font-size: 0.78rem; font-weight: 600; }
  .badge-DRAFT { background: #f1f5f9; color: #475569; }
  .badge-ISSUED { background: #dbeafe; color: #1d4ed8; }
  .badge-PARTIALLY_PAID { background: #fef3c7; color: #b45309; }
  .badge-PAID { background: #dcfce7; color: #15803d; }
  .badge-CANCELLED { background: #e2e8f0; color: #475569; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; }
  .info-block { background: #f8fafc; padding: 14px 16px; border-radius: 8px; border: 1px solid #e2e8f0; }
  .info-block h3 { margin: 0 0 8px; font-size: 0.85rem; text-transform: uppercase; color: #64748b; letter-spacing: 0.05em; }
  .info-block p { margin: 2px 0; font-size: 0.92rem; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  th, td { padding: 10px 12px; border-bottom: 1px solid #e2e8f0; font-size: 0.9rem; }
  th { background: #f1f5f9; text-align: left; font-weight: 600; }
  .totals { margin-top: 16px; display: flex; justify-content: flex-end; }
  .totals table { width: 360px; margin-top: 0; }
  .totals td { border: none; padding: 6px 8px; }
  .totals .grand { font-size: 1.05rem; font-weight: 700; color: #0f172a; border-top: 2px solid #0f172a; padding-top: 10px; }
  .footer { margin-top: 32px; display: grid; grid-template-columns: 1fr 1fr; gap: 32px; }
  .signature { text-align: center; font-size: 0.85rem; color: #475569; }
  .signature .line { margin-top: 64px; border-top: 1px dashed #94a3b8; padding-top: 4px; }
  @media print {
    body { background: #fff; padding: 0; }
    .sheet { box-shadow: none; border-radius: 0; max-width: none; padding: 16px 20px; }
    .actions { display: none; }
    @page { size: A4; margin: 12mm; }
  }
</style>
</head>
<body>
<div class="actions no-print">
  <button class="btn btn-primary" onclick="window.print()">🖨️ In / Lưu PDF</button>
  <button class="btn btn-secondary" onclick="window.close()">Đóng</button>
</div>
<div class="sheet">
  <div class="header">
    <div>
      <h1>HÓA ĐƠN</h1>
      <p style="margin:4px 0 0; color:#475569;">Nursing Home Management System</p>
    </div>
    <div class="meta">
      <div><strong>Số hóa đơn:</strong> ${escapeHtml(invoice.invoiceNumber || invoice._id.toString())}</div>
      <div><strong>Ngày xuất:</strong> ${formatDate(issueDate)}</div>
      <div><strong>Hạn thanh toán:</strong> ${formatDate(dueDate)}</div>
      <div><strong>Loại:</strong> ${escapeHtml(typeLabel)}</div>
      <div style="margin-top:6px;"><span class="badge badge-${statusKey}">${escapeHtml(statusLabel)}</span></div>
    </div>
  </div>

  <div class="info-grid">
    <div class="info-block">
      <h3>Người cao tuổi</h3>
      <p><strong>${escapeHtml(resident.fullName || '—')}</strong></p>
      ${resident.code ? `<p>Mã: ${escapeHtml(resident.code)}</p>` : ''}
      ${resident.dateOfBirth ? `<p>Ngày sinh: ${formatDate(resident.dateOfBirth)}</p>` : ''}
      ${resident.gender ? `<p>Giới tính: ${escapeHtml(resident.gender)}</p>` : ''}
      ${resident.phone ? `<p>SĐT: ${escapeHtml(resident.phone)}</p>` : ''}
    </div>
    <div class="info-block">
      <h3>Hợp đồng</h3>
      <p><strong>${escapeHtml(contract.contractNumber || '—')}</strong></p>
      ${contract.startDate ? `<p>Bắt đầu: ${formatDate(contract.startDate)}</p>` : ''}
      ${contract.endDate ? `<p>Kết thúc: ${formatDate(contract.endDate)}</p>` : ''}
      ${contract.monthlyFee ? `<p>Phí hàng tháng: ${formatVnd(contract.monthlyFee)}</p>` : ''}
      ${contract.durationMonths ? `<p>Thời hạn: ${escapeHtml(contract.durationMonths)} tháng</p>` : ''}
    </div>
    <div class="info-block">
      <h3>Kỳ thanh toán</h3>
      <p>Từ: <strong>${formatDate(billingStart)}</strong></p>
      <p>Đến: <strong>${formatDate(billingEnd)}</strong></p>
      <p>Hạn thanh toán: <strong>${formatDate(dueDate)}</strong></p>
    </div>
    <div class="info-block">
      <h3>Người thanh toán</h3>
      ${family ? `
        <p><strong>${escapeHtml(family.fullName || '—')}</strong></p>
        ${family.email ? `<p>Email: ${escapeHtml(family.email)}</p>` : ''}
        ${family.phone ? `<p>SĐT: ${escapeHtml(family.phone)}</p>` : ''}
      ` : '<p style="color:#94a3b8; font-style:italic;">Chưa có thông tin người thanh toán.</p>'}
    </div>
  </div>

  ${breakdownRows}

  <div class="totals">
    <table>
      <tr><td>Tạm tính</td><td style="text-align:right;">${formatVnd(subTotalExclTax)}</td></tr>
      ${tax > 0 ? `<tr><td>Thuế</td><td style="text-align:right;">${formatVnd(tax)}</td></tr>` : ''}
      <tr class="grand"><td>Tổng cộng</td><td style="text-align:right;">${formatVnd(totalAmount)}</td></tr>
      ${paid > 0 ? `<tr><td>Đã thanh toán</td><td style="text-align:right; color:#15803d;">${formatVnd(paid)}</td></tr>` : ''}
      ${remaining > 0 ? `<tr><td>Còn lại</td><td style="text-align:right; color:#b91c1c;">${formatVnd(remaining)}</td></tr>` : ''}
    </table>
  </div>

  ${invoice.cancellationReason ? `<p style="margin-top:20px; color:#b91c1c;"><strong>Lý do hủy:</strong> ${escapeHtml(invoice.cancellationReason)}</p>` : ''}

  <div class="footer">
    <div class="signature">
      <p><strong>Người lập hóa đơn</strong></p>
      <p style="font-size:0.78rem;">(Ký, ghi rõ họ tên)</p>
      <div class="line">${escapeHtml(invoice.createdBy || '')}</div>
    </div>
    <div class="signature">
      <p><strong>Người nộp tiền</strong></p>
      <p style="font-size:0.78rem;">(Ký, ghi rõ họ tên)</p>
      <div class="line">${escapeHtml(family?.fullName || '')}</div>
    </div>
  </div>

  <p style="text-align:center; margin-top:32px; font-size:0.78rem; color:#94a3b8;">
    Hóa đơn được tạo tự động bởi hệ thống Nursing Home Management — ${formatDate(new Date())}
  </p>
</div>
</body>
</html>`;

    const filename = `invoice-${invoice.invoiceNumber || invoice._id.toString()}.html`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(html);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message, errorCode: err.errorCode });
  }
};

module.exports = {
  createInvoiceFromContract,
  exportInvoiceHtml,
};
