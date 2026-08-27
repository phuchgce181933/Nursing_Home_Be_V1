const ServiceError = require('./serviceError');
const medicalChargeRepo = require('../repositories/medicalChargeRepository');

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

const updateCharge = async (id, body) => {
  const charge = await medicalChargeRepo.findById(id);
  if (!charge) throw new ServiceError('Không tìm thấy khoản phí', 404);

  for (const field of UPDATABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      charge[field] = body[field];
    }
  }
  await medicalChargeRepo.saveDoc(charge);
  return charge;
};

module.exports = { listCharges, getCharge, updateCharge };
