const admissionService = require('../services/admissionService');
const { normalizeAdmissionBody } = require('../utils/normalizeAdmissionBody');

const submitAdmissionRequest = async (req, res) => {
  try {
    const payload = normalizeAdmissionBody(req.body);
    const result = await admissionService.submitAdmissionRequest(req.user, payload, req);
    res.status(201).json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message, errorCode: err.errorCode });
  }
};

const submitGuestAdmissionRequest = async (req, res) => {
  try {
    const payload = normalizeAdmissionBody(req.body);
    const result = await admissionService.submitGuestAdmissionRequest(payload, req);
    res.status(201).json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message, errorCode: err.errorCode });
  }
};

const createWalkInAdmission = async (req, res) => {
  try {
    const payload = normalizeAdmissionBody(req.body);
    const result = await admissionService.createWalkInAdmission(req.user, payload, req);
    res.status(201).json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message, errorCode: err.errorCode });
  }
};

const listAdmissionRequests = async (req, res) => {
  try {
    const result = await admissionService.listAdmissionHistory(req.user, req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message, errorCode: err.errorCode });
  }
};

const getAdmissionRequest = async (req, res) => {
  try {
    const result = await admissionService.getAdmissionRequest(req.user, req.params.admissionId);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message, errorCode: err.errorCode });
  }
};

const cancelAdmissionRequest = async (req, res) => {
  try {
    const result = await admissionService.cancelAdmissionRequest(
      req.user,
      req.params.admissionId,
      req.body,
      req
    );
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message, errorCode: err.errorCode });
  }
};

// ── Re-submit a previous admission request (Family) ─────────────────────────────
// Used when the contract has ended (resident discharged, contract cancelled/expired)
// and the family wants to re-admit the same resident. Reuses the existing admission
// record (preserves resident info + applicant info) and resets workflow to 'new_request'
// so it goes through admin approval → doctor examination → contract creation again.
const resubmitAdmissionRequest = async (req, res) => {
  try {
    const result = await admissionService.resubmitAdmissionRequest(
      req.user,
      req.params.admissionId,
      req.body,
      req
    );
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message, errorCode: err.errorCode });
  }
};

// ── Check duplicate citizenId (real-time validation) ─────────────────────────────
const checkCitizenIdDuplicate = async (req, res) => {
  try {
    const result = await admissionService.checkCitizenIdDuplicate(req.user, req.query.citizenId);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message, errorCode: err.errorCode });
  }
};

// ── Admin controllers ──────────────────────────────────────────────────
const adminListAdmissions = async (req, res) => {
  try {
    const result = await admissionService.adminListAdmissions(req.query, req.user);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message, errorCode: err.errorCode });
  }
};

const adminGetAdmission = async (req, res) => {
  try {
    const result = await admissionService.adminGetAdmission(req.params.admissionId, req.user);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message, errorCode: err.errorCode });
  }
};

const approveAdmission = async (req, res) => {
  try {
    const result = await admissionService.approveAdmission(req.user, req.params.admissionId, req.body, req);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message, errorCode: err.errorCode });
  }
};

const rejectAdmission = async (req, res) => {
  try {
    const result = await admissionService.rejectAdmission(req.user, req.params.admissionId, req.body, req);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message, errorCode: err.errorCode });
  }
};

// ── UC-6.16: Pre-admission Consultation ────────────────────────────────────────
const preAdmissionConsultation = async (req, res) => {
  try {
    const result = await admissionService.preAdmissionConsultation(req.user, req.params.admissionId, req.body, req);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message, errorCode: err.errorCode });
  }
};

// ── UC-6.17: Initial Assessment Scheduling ─────────────────────────────────────
const scheduleInitialAssessment = async (req, res) => {
  try {
    const result = await admissionService.scheduleInitialAssessment(req.user, req.params.admissionId, req.body, req);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message, errorCode: err.errorCode });
  }
};

// ── UC-6.19: Evaluate Admission Eligibility ────────────────────────────────────
const evaluateAdmissionEligibility = async (req, res) => {
  try {
    const result = await admissionService.evaluateAdmissionEligibility(req.user, req.params.admissionId, req.body, req);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message, errorCode: err.errorCode });
  }
};

// ── UC-6.24: Assign Service Package ────────────────────────────────────────────
const assignServicePackage = async (req, res) => {
  try {
    const result = await admissionService.assignServicePackage(req.user, req.params.admissionId, req.body, req);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message, errorCode: err.errorCode });
  }
};

// ── UC-6.25: Create Admission Contract ─────────────────────────────────────────
const createAdmissionContract = async (req, res) => {
  try {
    const result = await admissionService.createAdmissionContract(req.user, req.params.admissionId, req.body, req);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message, errorCode: err.errorCode });
  }
};

const cancelAdmissionContract = async (req, res) => {
  try {
    const result = await admissionService.cancelAdmissionContract(req.user, req.params.admissionId, req.body, req);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const changeContractServicePackage = async (req, res) => {
  try {
    const result = await admissionService.changeContractServicePackage(req.user, req.params.admissionId, req.body, req);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

// ── UC-6.26: Check-in Resident ─────────────────────────────────────────────────
const checkInResident = async (req, res) => {
  try {
    const result = await admissionService.checkInResident(req.user, req.params.admissionId, req.body, req);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message, errorCode: err.errorCode });
  }
};

// ── Extend Admission Contract ───────────────────────────────────────────────────
const extendAdmissionContract = async (req, res) => {
  try {
    const result = await admissionService.extendAdmissionContract(req.user, req.params.admissionId, req.body);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message, errorCode: err.errorCode });
  }
};

module.exports = {
  submitAdmissionRequest,
  submitGuestAdmissionRequest,
  createWalkInAdmission,
  listAdmissionRequests,
  getAdmissionRequest,
  cancelAdmissionRequest,
  resubmitAdmissionRequest,
  checkCitizenIdDuplicate,
  adminListAdmissions,
  adminGetAdmission,
  approveAdmission,
  rejectAdmission,
  preAdmissionConsultation,
  scheduleInitialAssessment,
  evaluateAdmissionEligibility,
  assignServicePackage,
  createAdmissionContract,
  cancelAdmissionContract,
  changeContractServicePackage,
  checkInResident,
  extendAdmissionContract,
};

