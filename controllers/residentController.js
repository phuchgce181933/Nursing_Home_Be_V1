const residentService = require('../services/residentService');
const { createAuditLog } = require('../utils/auditLog');
const { sendApiError } = require('../utils/apiErrorResponse');

const listResidents = async (req, res) => {
  try {
    const { page, limit, floorId, roomId, search, status } = req.query;

    if (page !== undefined) {
      const result = await residentService.listResidentsForFamilyManagement({
        search,
        status,
        page,
        limit,
      });
      return res.json(result);
    }

    const result = await residentService.listResidentsForAssignment({
      floorId,
      roomId,
      search,
      status,
    }, req.user);
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

const getResidentFamilyInfo = async (req, res) => {
  try {
    const result = await residentService.getResidentFamilyInfo(req.params.residentId);
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

const addEmergencyContact = async (req, res) => {
  try {
    const result = await residentService.addEmergencyContact(req.params.residentId, req.body);
    res.status(201).json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

const replaceEmergencyContacts = async (req, res) => {
  try {
    const contacts = req.body.contacts ?? req.body.emergencyContacts;
    if (!Array.isArray(contacts)) {
      return res.status(400).json({ message: 'contacts phải là một mảng' });
    }
    const result = await residentService.replaceEmergencyContacts(req.params.residentId, contacts);
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

const updateEmergencyContact = async (req, res) => {
  try {
    const result = await residentService.updateEmergencyContact(
      req.params.residentId,
      req.params.contactId,
      req.body
    );
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

const removeEmergencyContact = async (req, res) => {
  try {
    const result = await residentService.removeEmergencyContact(
      req.params.residentId,
      req.params.contactId
    );
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

const getResidentsAreaSummary = async (req, res) => {
  try {
    const result = await residentService.getResidentsAreaSummary(req.query);
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

const listResidentsByArea = async (req, res) => {
  try {
    const result = await residentService.listResidentsByArea(req.query);
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

const getResidentDetail = async (req, res) => {
  try {
    const result = await residentService.getResidentDetail(req.params.residentId);
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

const getTransferTargets = async (req, res) => {
  try {
    const result = await residentService.getTransferTargets(req.params.residentId, req.query);
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

const transferResidentToRoom = async (req, res) => {
  try {
    const result = await residentService.transferResidentToRoom(req.params.residentId, req.body);

    await createAuditLog({
      actorUserId: req.user._id,
      actorRole: req.user.role,
      action: 'TRANSFER_RESIDENT_ROOM',
      displayAction: 'Chuyển cư dân',
      businessModule: 'resident',
      module: 'resident',
      description: `Chuyển cư dân ${result.resident.fullName || req.params.residentId} từ ${result.from.room?.roomNumber || 'phòng cũ'} sang ${result.to.room?.roomNumber || 'phòng mới'}`,
      targetEntityType: 'Resident',
      targetEntityId: req.params.residentId,
      targetName: result.resident.residentCode || result.resident.fullName || req.params.residentId,
      beforeData: result.from,
      afterData: result.to,
      req,
      statusCode: 200,
    });

    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

const listResidentsForInitialHealth = async (req, res) => {
  try {
    const result = await residentService.listResidentsForInitialHealth(req.query);
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

const listResidentsForPreExisting = async (req, res) => {
  try {
    const result = await residentService.listResidentsForPreExisting(req.query);
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

const listResidentsForDrugAllergies = async (req, res) => {
  try {
    const result = await residentService.listResidentsForDrugAllergies(req.query);
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

const getInitialHealth = async (req, res) => {
  try {
    const result = await residentService.getInitialHealth(req.params.residentId);
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

const recordInitialHealth = async (req, res) => {
  try {
    const result = await residentService.recordInitialHealth(req.params.residentId, req.body);
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

const getPreExistingConditions = async (req, res) => {
  try {
    const result = await residentService.getPreExistingConditions(req.params.residentId);
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

const updatePreExistingConditions = async (req, res) => {
  try {
    const result = await residentService.updatePreExistingConditions(req.params.residentId, req.body);
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

const getDrugAllergies = async (req, res) => {
  try {
    const result = await residentService.getDrugAllergies(req.params.residentId);
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

const updateDrugAllergies = async (req, res) => {
  try {
    const result = await residentService.updateDrugAllergies(req.params.residentId, req.body);
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

// UC-132: Doctor/Nurse export of a resident's health report (CSV).
const downloadResidentReport = async (req, res) => {
  try {
    const familyPortalService = require('../services/familyPortalService');
    const { csv, filename } = await familyPortalService.staffDownloadReport(req.user, req.params.residentId, req.query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('﻿' + csv);
  } catch (err) {
    sendApiError(res, err);
  }
};

const adminCreateResident = async (req, res) => {
  try {
    const result = await residentService.adminCreateResident(req.user, req.body, req);
    res.status(201).json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

const adminListResidents = async (req, res) => {
  try {
    const result = await residentService.adminListResidents(req.query);
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

const adminGetResident = async (req, res) => {
  try {
    const result = await residentService.adminGetResident(req.params.residentId);
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

const adminReleaseResident = async (req, res) => {
  try {
    const result = await residentService.adminReleaseResident(req.user, req.params.residentId, req);
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

const adminUpdatePersonalInfo = async (req, res) => {
  try {
    const result = await residentService.adminUpdatePersonalInfo(
      req.user,
      req.params.residentId,
      req.body,
      req
    );
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

const adminUpdateFamilyInfo = async (req, res) => {
  try {
    const result = await residentService.adminUpdateFamilyInfo(
      req.user,
      req.params.residentId,
      req.body,
      req
    );
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

const adminUploadAvatar = async (req, res) => {
  try {
    const residentId = req.params.residentId;
    const file = req.file;
    const result = await residentService.adminUploadAvatar(req.user, residentId, file, req);
    res.json(result);
  } catch (err) {
    console.error('adminUploadAvatar error:', err);
    sendApiError(res, err);
  }
};

module.exports = {
  listResidents,
  getResidentsAreaSummary,
  listResidentsByArea,
  getResidentDetail,
  getTransferTargets,
  transferResidentToRoom,
  listResidentsForInitialHealth,
  listResidentsForPreExisting,
  listResidentsForDrugAllergies,
  getInitialHealth,
  recordInitialHealth,
  getPreExistingConditions,
  updatePreExistingConditions,
  getDrugAllergies,
  updateDrugAllergies,
  downloadResidentReport,
  getResidentFamilyInfo,
  addEmergencyContact,
  replaceEmergencyContacts,
  updateEmergencyContact,
  removeEmergencyContact,
  adminCreateResident,
  adminListResidents,
  adminGetResident,
  adminReleaseResident,
  adminUpdatePersonalInfo,
  adminUpdateFamilyInfo,
  adminUploadAvatar,
};
