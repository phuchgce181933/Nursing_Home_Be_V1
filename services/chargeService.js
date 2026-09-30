const { Types } = require('mongoose');
const clinicalServiceRepo = require('../repositories/clinicalServiceRepository');
const medicalChargeRepo = require('../repositories/medicalChargeRepository');
const auditLogRepo = require('../repositories/auditLogRepository');
const residentRepo = require('../repositories/residentRepository');

const createChargeForRecord = async (opts = {}) => {
  // opts: { originType, originId, residentId, serviceCode, serviceName, category, performedById, performedBy, performedAt, quantity, unitPrice, metadata, req }
  console.log('[chargeService.createChargeForRecord] Called with opts:', {
    originType: opts.originType,
    originId: opts.originId,
    residentId: opts.residentId,
    serviceCode: opts.serviceCode,
    serviceName: opts.serviceName,
    category: opts.category,
    quantity: opts.quantity,
    unitPrice: opts.unitPrice,
  });

  if (!opts.residentId) {
    console.error('[chargeService] Missing residentId - returning null');
    return null;
  }

  // Determine language from req
  const isVi = !opts.req || opts.req?.i18n?.language === 'vi' || opts.req?.headers?.['accept-language']?.includes('vi');

  // Resolve resident name for audit log
  const resident = await residentRepo.findById(opts.residentId);
  const residentFullName = resident
    ? (resident.fullName || resident.profile?.fullName || resident.profile?.fullname || String(opts.residentId))
    : String(opts.residentId);

  // try to resolve clinical service by code (don't require active=true for backward compatibility)
  let svc = null;
  if (opts.serviceCode) {
    svc = await clinicalServiceRepo.findOneLean({ serviceCode: opts.serviceCode });
    console.log('[chargeService] Lookup by serviceCode:', opts.serviceCode, '→ Found:', !!svc, svc ? `(id: ${svc._id})` : '');
  }
  if (!svc && opts.category) {
    svc = await clinicalServiceRepo.findOneLean({ category: opts.category });
    console.log('[chargeService] Lookup by category:', opts.category, '→ Found:', !!svc);
  }

  // If no matching ClinicalService found but caller provided a serviceCode, auto-create a ClinicalService
  if (!svc && opts.serviceCode) {
    try {
      console.log('[chargeService] No ClinicalService found for serviceCode, creating new ClinicalService:', opts.serviceCode);
      const svcData = {
        serviceCode: opts.serviceCode,
        serviceName: opts.serviceName || opts.serviceCode,
        category: opts.category || 'PHYSICAL_EXAM',
        description: opts.description || '',
        unitPrice: opts.unitPrice != null ? Number(opts.unitPrice) : 0,
        active: true,
      };
      const created = await clinicalServiceRepo.create(svcData);
      svc = created.toObject ? created.toObject() : created;
      console.log('[chargeService] Auto-created ClinicalService id:', svc._id);
    } catch (err) {
      console.error('[chargeService] Failed to auto-create ClinicalService:', err.message);
    }
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

  let charge;
  try {
    charge = await medicalChargeRepo.create({
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
    console.log('[chargeService] ✓ Charge saved successfully:', charge._id, '| totalPrice:', charge.totalPrice);
  } catch (err) {
    console.error('[chargeService] ✗ Failed to save charge:', err.message);
    if (err && err.stack) {
      console.error(err.stack);
    }
    throw err;
  }

  const displayActionVi = 'Tạo chi phí';
  const displayActionEn = 'Charge generated';
  const descriptionVi = `Tạo chi phí dịch vụ "${serviceName}" cho cư dân "${residentFullName}" (${quantity} × ${unitPrice.toLocaleString('vi-VN')})`;
  const descriptionEn = `Charge generated for "${serviceName}" (${quantity} × ${unitPrice}) for "${residentFullName}"`;

  try {
    await auditLogRepo.create({
      action: 'CHARGE_GENERATED',
      displayAction: isVi ? displayActionVi : displayActionEn,
      businessModule: 'clinical-billing',
      module: opts.originType || 'clinical',
      performedBy: opts.performedBy || '',
      performedByRole: '',
      targetEntityType: 'Resident',
      targetEntityId: new Types.ObjectId(opts.residentId),
      targetName: `${isVi ? 'Chi phí cho' : 'Charge for'} ${residentFullName} — ${serviceName}`,
      description: isVi ? descriptionVi : descriptionEn,
      afterData: {
        chargeId: charge._id,
        totalPrice: charge.totalPrice,
        residentId: String(opts.residentId),
        residentName: residentFullName,
        serviceName,
        serviceCode: opts.serviceCode,
        category: opts.category,
        quantity,
        unitPrice,
      },
    });
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
