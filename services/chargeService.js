const { Types } = require('mongoose');
const ClinicalService = require('../models/clinicalService');
const MedicalCharge = require('../models/medicalCharge');
const AuditLog = require('../models/auditLog');

const createChargeForRecord = async (opts = {}) => {
  // opts: { originType, originId, residentId, serviceCode, serviceName, category, performedById, performedBy, performedAt, quantity, unitPrice, metadata }
  console.log('[chargeService.createChargeForRecord] Called with opts:', JSON.stringify(opts, null, 2));
  
  if (!opts.residentId) {
    console.error('[chargeService] Missing residentId - returning null');
    return null;
  }

  // try to resolve clinical service by code (don't require active=true for backward compatibility)
  let svc = null;
  if (opts.serviceCode) {
    svc = await ClinicalService.findOne({ serviceCode: opts.serviceCode }).lean();
    console.log('[chargeService] Lookup by serviceCode:', opts.serviceCode, '→ Found:', !!svc, svc ? `(id: ${svc._id})` : '');
  }
  if (!svc && opts.category) {
    svc = await ClinicalService.findOne({ category: opts.category }).lean();
    console.log('[chargeService] Lookup by category:', opts.category, '→ Found:', !!svc);
  }

  const unitPrice = opts.unitPrice != null ? Number(opts.unitPrice) : (svc ? svc.unitPrice : 0);
  const serviceId = svc ? svc._id : undefined;
  const serviceName = opts.serviceName || (svc ? svc.serviceName : (opts.serviceCode || 'Clinical Service'));
  const quantity = opts.quantity || 1;

  console.log('[chargeService] Creating charge with:', {
    residentId: opts.residentId,
    serviceCode: opts.serviceCode,
    serviceName: serviceName,
    quantity: quantity,
    unitPrice: unitPrice,
    category: opts.category,
    serviceId: serviceId
  });

  const charge = new MedicalCharge({
    residentId: new Types.ObjectId(opts.residentId),
    serviceId,
    serviceCode: opts.serviceCode,
    serviceName,
    category: opts.category,
    quantity,
    unitPrice,
    performedBy: opts.performedBy,
    performedById: opts.performedById,
    performedAt: opts.performedAt || new Date(),
    billingStatus: 'PENDING',
    originType: opts.originType,
    originId: opts.originId,
    metadata: opts.metadata || {},
  });

  try {
    await charge.save();
    console.log('[chargeService] ✓ Charge saved successfully:', charge._id, '| totalPrice:', charge.totalPrice);
  } catch (err) {
    console.error('[chargeService] ✗ Failed to save charge:', err.message);
    if (err && err.stack) {
      console.error(err.stack);
    }
    throw err;
  }

  // write audit log
  try {
    const audit = new AuditLog({
      action: 'CHARGE_GENERATED',
      displayAction: 'Charge generated',
      businessModule: 'clinical-billing',
      module: opts.originType || 'clinical',
      performedBy: opts.performedBy || '',
      performedByRole: '',
      targetEntityType: 'Resident',
      targetEntityId: new Types.ObjectId(opts.residentId),
      targetName: serviceName,
      description: `Charge generated for ${serviceName} (${quantity} x ${unitPrice})`,
      afterData: { chargeId: charge._id, totalPrice: charge.totalPrice },
    });
    await audit.save();
  } catch (err) {
    console.error('Failed to write audit log for charge:', err);
    if (err && err.stack) {
      console.error(err.stack);
    }
  }

  return charge;
};

module.exports = {
  createChargeForRecord,
};
