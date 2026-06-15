const familyPortalService = require('../services/familyPortalService');
const paymentService = require('../services/paymentService');
const walletService = require('../services/walletService');

const getResidents = async (req, res) => {
  try {
    const result = await familyPortalService.getResidents(req.user);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getResident = async (req, res) => {
  try {
    const result = await familyPortalService.getResident(req.user, req.params.residentId);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getResidentBillingSummary = async (req, res) => {
  try {
    const result = await familyPortalService.getResidentBillingSummary(req.user, req.params.residentId);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getResidentInvoices = async (req, res) => {
  try {
    const result = await familyPortalService.getResidentInvoices(req.user, req.params.residentId, req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getInvoicePaymentUrl = async (req, res) => {
  try {
    const result = await familyPortalService.getInvoicePaymentUrl(req.user, req.params.residentId, req.params.invoiceId, req);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getVitals = async (req, res) => {
  try {
    const result = await familyPortalService.getVitals(req.user, req.params.residentId);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getHealthHistory = async (req, res) => {
  try {
    const result = await familyPortalService.getHealthHistory(req.user, req.params.residentId, req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getHealthChart = async (req, res) => {
  try {
    const result = await familyPortalService.getHealthChart(req.user, req.params.residentId, req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getCareNotes = async (req, res) => {
  try {
    const result = await familyPortalService.getCareNotes(req.user, req.params.residentId, req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getMedications = async (req, res) => {
  try {
    const result = await familyPortalService.getMedications(req.user, req.params.residentId, req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getPrescriptions = async (req, res) => {
  try {
    const result = await familyPortalService.getPrescriptions(req.user, req.params.residentId, req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getActivities = async (req, res) => {
  try {
    const result = await familyPortalService.getActivities(req.user, req.params.residentId, req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getCareAppointments = async (req, res) => {
  try {
    const result = await familyPortalService.getCareAppointments(req.user, req.params.residentId, req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getHealthReport = async (req, res) => {
  try {
    const result = await familyPortalService.getHealthReport(req.user, req.params.residentId, req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getDailyActivities = async (req, res) => {
  try {
    const result = await familyPortalService.getDailyActivities(req.user, req.params.residentId, req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getCareSchedule = async (req, res) => {
  try {
    const result = await familyPortalService.getCareSchedule(req.user, req.params.residentId, req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const downloadReport = async (req, res) => {
  try {
    const { csv, filename } = await familyPortalService.downloadReport(req.user, req.params.residentId, req.query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('﻿' + csv);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getWalletBalance = async (req, res) => {
  try {
    const result = await walletService.getWalletBalance(req.user);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const generateWalletTopupUrl = async (req, res) => {
  try {
    const { amount } = req.body;
    const result = await walletService.generateTopupPaymentUrl(req.user, amount, req);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const confirmWalletTopup = async (req, res) => {
  try {
    const { topupId, status } = req.body;

    if (topupId && status === 'PAID') {
      await walletService.confirmTopup(req.user._id, topupId, topupId);
    }

    const walletBalance = await walletService.getWalletBalance(req.user);

    res.json({ 
      success: true, 
      message: 'Kiểm tra trạng thái nạp tiền',
      data: walletBalance 
    });
  } catch (err) {
    console.error('Confirm topup error:', err);
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getWalletTopupCheckoutPage = async (req, res) => {
  try {
    const { topupId } = req.params;
    const { clientId, checksum, amount } = req.query;

    // Verify checksum
    if (!paymentService.verifyPayosWalletTopupChecksum(topupId, amount, clientId, checksum)) {
      return res.status(403).json({ message: 'Invalid checksum - payment verification failed' });
    }

    // Create virtual invoice object for PayOS
    const topupInvoice = {
      _id: topupId,
      invoiceNumber: `TOPUP-${topupId.split('_').pop()}`,
      totalAmount: parseInt(amount),
      residentName: 'Nạp Tiền Ví',
      description: `Nạp tiền vào ví - ${parseInt(amount).toLocaleString('vi-VN')}₫`,
    };

    // Call PayOS API to get payment data (qrCode, checkoutUrl, etc.)
    const payosData = await paymentService.createPayosPaymentRequest({
      invoice: topupInvoice,
      req,
    });

    // Debug: Log what we received from PayOS
    console.log('PayOS Response for Topup:', JSON.stringify({
      hasQrCode: !!payosData.qrCode,
      qrCodeLength: payosData.qrCode ? payosData.qrCode.length : 0,
      qrCodeStart: payosData.qrCode ? payosData.qrCode.substring(0, 50) : 'N/A',
      hasCheckoutUrl: !!payosData.checkoutUrl,
      payosDataKeys: Object.keys(payosData),
    }));

    // Determine QR code source
    let qrImageHtml = '';
    if (payosData.qrCode) {
      // If qrCode exists, try to display it
      // It could be base64, URL, or other format
      const qrCode = payosData.qrCode;
      if (qrCode.startsWith('data:image') || qrCode.startsWith('http')) {
        // Already a data URL or HTTP URL
        qrImageHtml = `<img src="${qrCode}" alt="PayOS QR Code" style="max-width: 300px; height: auto;" />`;
      } else if (qrCode.length > 100) {
        // Likely base64 string
        qrImageHtml = `<img src="data:image/png;base64,${qrCode}" alt="PayOS QR Code" style="max-width: 300px; height: auto;" />`;
      } else {
        // Display as text (QR data)
        qrImageHtml = `<div style="background: #f0f9ff; padding: 12px; border-radius: 6px; word-break: break-all; font-size: 12px;">${qrCode}</div>`;
      }
    }

    // Return HTML page with QR code
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Nạp Tiền Vào Ví</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: Arial, sans-serif; background: #f5f5f5; padding: 20px; }
          .container { max-width: 500px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; }
          h1 { color: #333; font-size: 20px; }
          p { color: #666; }
          .success { color: #10b981; font-weight: bold; }
          .amount { font-size: 18px; font-weight: bold; color: #2563eb; margin: 10px 0; }
          .qr-container { text-align: center; margin: 20px 0; }
          .qr-container img { max-width: 100%; height: auto; }
          .instruction { background: #f0f9ff; padding: 12px; border-radius: 6px; margin: 15px 0; font-size: 14px; }
          .button { display: inline-block; padding: 10px 20px; background: #2563eb; color: white; border-radius: 6px; text-decoration: none; margin-top: 10px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Nạp Tiền Vào Ví</h1>
          <p><span class="success">✓ Xác thực thành công</span></p>
          <div class="amount">Số tiền: ${parseInt(amount).toLocaleString('vi-VN')}₫</div>
          
          <div class="qr-container">
            <p><strong>Quét mã QR để thanh toán:</strong></p>
            ${qrImageHtml || '<p style="color: #999;">Không thể tải mã QR. Vui lòng sử dụng link thanh toán web.</p>'}
          </div>

          <div class="instruction">
            <p>💳 <strong>Hướng dẫn thanh toán:</strong></p>
            <p>1. Mở ứng dụng ngân hàng hoặc ứng dụng thanh toán</p>
            <p>2. Chọn chức năng quét mã QR</p>
            <p>3. Quét mã QR ở trên để thanh toán</p>
          </div>

          ${payosData.checkoutUrl ? `<p style="text-align: center;"><a class="button" href="${payosData.checkoutUrl}" target="_blank">Thanh toán trên web</a></p>` : ''}
        </div>
      </body>
      </html>
    `;
    res.type('text/html').send(html);
  } catch (err) {
    console.error('Wallet Topup Checkout Error:', err);
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

module.exports = {
  getResidents,
  getResident,
  getResidentBillingSummary,
  getResidentInvoices,
  getInvoicePaymentUrl,
  getWalletBalance,
  generateWalletTopupUrl,
  confirmWalletTopup,
  getWalletTopupCheckoutPage,
  getVitals,
  getHealthHistory,
  getHealthChart,
  getCareNotes,
  getMedications,
  getPrescriptions,
  getActivities,
  getCareAppointments,
  getHealthReport,
  getDailyActivities,
  getCareSchedule,
  downloadReport,
};
