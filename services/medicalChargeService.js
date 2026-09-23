const ServiceError = require('./serviceError');
const medicalChargeRepo = require('../repositories/medicalChargeRepository');
const { createAuditLog } = require('../utils/auditLog');

const UPDATABLE_FIELDS = [
  'serviceName',
  'category',
  'quantity',
  'unitPrice',
  'billingStatus',
  'performedAt',
  'metadata',
];

const listCharges = async ({ residentId, billingStatus } = {}) => {
  const filter = {};
  if (residentId) filter.residentId = residentId;
  if (billingStatus) filter.billingStatus = billingStatus;
  return medicalChargeRepo.findAll(filter, { sort: { performedAt: -1 }, limit: 500 });
};

const getCharge = async (id) => {
  const charge = await medicalChargeRepo.findById(id);
  if (!charge) throw new ServiceError('Không tìm thấy khoản phí', 404);
  return charge;
};

const updateCharge = async (id, body, currentUser = null, req = null) => {
  const charge = await medicalChargeRepo.findById(id);
  if (!charge) throw new ServiceError('Không tìm thấy khoản phí', 404);

  const beforeData = {};
  for (const field of UPDATABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      beforeData[field] = charge[field];
    }
  }

  for (const field of UPDATABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      charge[field] = body[field];
    }
  }
  await medicalChargeRepo.saveDoc(charge);

  await createAuditLog({
    actorUserId: currentUser?._id,
    actorRole: currentUser?.role,
    action: 'UPDATE_MEDICAL_CHARGE',
    displayAction: 'Cập nhật chi phí y tế',
    module: 'billing',
    businessModule: 'billing',
    targetEntityType: 'MedicalCharge',
    targetEntityId: id,
    targetName: charge.serviceName || `Chi phí #${id}`,
    description: `Cập nhật chi phí y tế ${charge.serviceName || id}`,
    beforeData,
    afterData: body,
    req,
  });

  return charge;
};

module.exports = { listCharges, getCharge, updateCharge };
