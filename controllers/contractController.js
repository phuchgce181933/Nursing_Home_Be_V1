const contractService = require('../services/contractService');

// UC-210: Create Contract
const createContract = async (req, res) => {
  try {
    const result = await contractService.createContract(
      req.user,
      req.params.admissionId,
      req.body,
      req
    );
    res.status(201).json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message, errorCode: err.errorCode });
  }
};

// UC-211: List Contracts
const listContracts = async (req, res) => {
  try {
    const result = await contractService.listContracts(req.query, req.user);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message, errorCode: err.errorCode });
  }
};

// UC-212: Get Contract Details
const getContractDetails = async (req, res) => {
  try {
    const result = await contractService.getContractDetails(req.params.contractId, req.user);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message, errorCode: err.errorCode });
  }
};

// UC-213: Renew Contract
const renewContract = async (req, res) => {
  try {
    const result = await contractService.renewContract(
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

// UC-214: Terminate Contract
const terminateContract = async (req, res) => {
  try {
    const result = await contractService.terminateContract(
      req.user,
      req.params.contractId,
      req.body,
      req
    );
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message, errorCode: err.errorCode });
  }
};

// UC-215: Get Contract History
const getContractHistory = async (req, res) => {
  try {
    const result = await contractService.getContractHistory(
      req.params.admissionId,
      req.query
    );
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message, errorCode: err.errorCode });
  }
};

// Issue Invoices: flip DRAFT → ISSUED for all (or selected) invoices of a contract.
const issueInvoices = async (req, res) => {
  try {
    const result = await contractService.issueInvoices(
      req.user,
      req.params.contractId,
      req.body || {},
      req
    );
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message, errorCode: err.errorCode });
  }
};

// Recalculate DRAFT invoice prices for a contract using the current
// contract.monthlyFee (preferred) or servicePackage.monthlyPrice as fallback.
const recalculateContractInvoices = async (req, res) => {
  try {
    const result = await contractService.recalculateContractInvoices(
      req.user,
      req.params.contractId,
      req
    );
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message, errorCode: err.errorCode });
  }
};

// Cập nhật giá cho một hóa đơn DRAFT (trước khi xuất)
const updateDraftInvoicePrice = async (req, res) => {
  try {
    const result = await contractService.updateDraftInvoicePrice(
      req.user,
      req.params.invoiceId,
      req.body || {},
      req
    );
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message, errorCode: err.errorCode });
  }
};

// Soft-delete (Dừng) hóa đơn DRAFT
const cancelDraftInvoice = async (req, res) => {
  try {
    const result = await contractService.softDeleteDraftInvoice(
      req.user,
      req.params.invoiceId,
      req.body || {},
      req
    );
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message, errorCode: err.errorCode });
  }
};

// Chuyển trạng thái hóa đơn
const transitionInvoiceStatus = async (req, res) => {
  console.log('🔄 [TRANSITION_INVOICE_CTRL] hit', {
    invoiceId: req.params.invoiceId,
    body: req.body,
    userId: req.user?._id?.toString(),
  });
  try {
    const result = await contractService.transitionInvoiceStatus(
      req.user,
      req.params.invoiceId,
      req.body || {},
      req
    );
    console.log('🔄 [TRANSITION_INVOICE_CTRL] success', result);
    res.json(result);
  } catch (err) {
    console.error('🔄 [TRANSITION_INVOICE_CTRL] error', {
      message: err.message,
      statusCode: err.statusCode,
      stack: err.stack,
    });
    res.status(err.statusCode || 500).json({ message: err.message, errorCode: err.errorCode });
  }
};

module.exports = {
  createContract,
  listContracts,
  getContractDetails,
  renewContract,
  terminateContract,
  getContractHistory,
  issueInvoices,
  recalculateContractInvoices,
  updateDraftInvoicePrice,
  cancelDraftInvoice,
  transitionInvoiceStatus,
};
