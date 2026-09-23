const ServiceError = require('./serviceError');
const clinicalServiceRepo = require('../repositories/clinicalServiceRepository');
const { createAuditLog } = require('../utils/auditLog');

const validateFieldThresholds = (field) => {
  if (!field || field.type !== 'NUMBER') return null;

  const hasCommon =
    (field.min !== '' && field.min !== undefined && field.min !== null) ||
    (field.max !== '' && field.max !== undefined && field.max !== null);
  const hasMale =
    (field.maleMin !== '' && field.maleMin !== undefined && field.maleMin !== null) ||
    (field.maleMax !== '' && field.maleMax !== undefined && field.maleMax !== null);
  const hasFemale =
    (field.femaleMin !== '' && field.femaleMin !== undefined && field.femaleMin !== null) ||
    (field.femaleMax !== '' && field.femaleMax !== undefined && field.femaleMax !== null);

  if (hasCommon && (hasMale || hasFemale)) {
    return `Trường "${field.label}" không thể vừa dùng ngưỡng chung vừa dùng ngưỡng riêng cho nam/nữ.`;
  }

  if (hasMale || hasFemale) {
    const maleMin = field.maleMin === '' || field.maleMin === undefined || field.maleMin === null ? null : Number(field.maleMin);
    const maleMax = field.maleMax === '' || field.maleMax === undefined || field.maleMax === null ? null : Number(field.maleMax);
    const femaleMin = field.femaleMin === '' || field.femaleMin === undefined || field.femaleMin === null ? null : Number(field.femaleMin);
    const femaleMax = field.femaleMax === '' || field.femaleMax === undefined || field.femaleMax === null ? null : Number(field.femaleMax);

    if (maleMin === null || maleMax === null || femaleMin === null || femaleMax === null) {
      return `Trường "${field.label}" khi dùng ngưỡng riêng cho nam/nữ cần nhập đầy đủ Min/Max cho cả nam và nữ.`;
    }

    if ([maleMin, maleMax, femaleMin, femaleMax].some((value) => Number.isNaN(value) || value <= 1)) {
      return `Trường "${field.label}" cần có giá trị ngưỡng riêng lớn hơn 1.`;
    }

    if (maleMin >= maleMax || femaleMin >= femaleMax) {
      return `Trường "${field.label}" có Min lớn hơn hoặc bằng Max.`;
    }
  }

  if (hasCommon) {
    const min = field.min === '' || field.min === undefined || field.min === null ? null : Number(field.min);
    const max = field.max === '' || field.max === undefined || field.max === null ? null : Number(field.max);
    if (min === null || max === null) {
      return `Trường "${field.label}" khi dùng ngưỡng chung cần nhập đầy đủ Min chung và Max chung.`;
    }
    if ([min, max].some((value) => Number.isNaN(value) || value <= 1)) {
      return `Trường "${field.label}" cần có giá trị ngưỡng chung lớn hơn 1.`;
    }
    if (min >= max) {
      return `Trường "${field.label}" có Min chung lớn hơn hoặc bằng Max chung.`;
    }
  }

  return null;
};

const listServices = async ({ active, category, search } = {}) => {
  const filter = {};
  if (active !== undefined) filter.active = active;
  if (category) filter.category = category;
  if (search) {
    filter.$or = [
      { serviceName: { $regex: search, $options: 'i' } },
      { serviceCode: { $regex: search, $options: 'i' } },
    ];
  }
  return clinicalServiceRepo.findAll(filter);
};

const getService = async (id) => {
  const svc = await clinicalServiceRepo.findById(id);
  if (!svc) throw new ServiceError('Không tìm thấy dịch vụ', 404);
  return svc;
};

const createService = async (body, req) => {
  if (Array.isArray(body.fields)) {
    for (const field of body.fields) {
      const error = validateFieldThresholds(field);
      if (error) throw new ServiceError(error, 400);
    }
  }
  const svc = await clinicalServiceRepo.create(body);

  await createAuditLog({
    actorUserId: req?.user?._id,
    actorRole: req?.user?.role,
    action: 'CREATE_CLINICAL_SERVICE',
    displayAction: 'Tạo dịch vụ lâm sàng',
    module: 'clinicalService',
    businessModule: 'clinicalService',
    targetEntityType: 'ClinicalService',
    targetEntityId: svc._id,
    targetName: svc.serviceName,
    description: `Tạo dịch vụ lâm sàng "${svc.serviceName}"`,
    afterData: {
      serviceCode: svc.serviceCode,
      serviceName: svc.serviceName,
      category: svc.category,
      description: svc.description,
      unitPrice: svc.unitPrice,
      active: svc.active,
      fields: svc.fields,
    },
    req,
  });

  return svc;
};

const updateService = async (id, body, req) => {
  const svc = await clinicalServiceRepo.findById(id);
  if (!svc) throw new ServiceError('Không tìm thấy dịch vụ', 404);

  if (Array.isArray(body.fields)) {
    for (const field of body.fields) {
      const error = validateFieldThresholds(field);
      if (error) throw new ServiceError(error, 400);
    }
  }
  const beforeData = {
    serviceCode: svc.serviceCode,
    serviceName: svc.serviceName,
    category: svc.category,
    description: svc.description,
    unitPrice: svc.unitPrice,
    active: svc.active,
    fields: svc.fields,
  };
  Object.assign(svc, body);
  await clinicalServiceRepo.saveDoc(svc);

  await createAuditLog({
    actorUserId: req?.user?._id,
    actorRole: req?.user?.role,
    action: 'UPDATE_CLINICAL_SERVICE',
    displayAction: 'Cập nhật dịch vụ lâm sàng',
    module: 'clinicalService',
    businessModule: 'clinicalService',
    targetEntityType: 'ClinicalService',
    targetEntityId: svc._id,
    targetName: svc.serviceName,
    description: `Cập nhật dịch vụ lâm sàng "${svc.serviceName}"`,
    beforeData,
    afterData: {
      serviceCode: svc.serviceCode,
      serviceName: svc.serviceName,
      category: svc.category,
      description: svc.description,
      unitPrice: svc.unitPrice,
      active: svc.active,
      fields: svc.fields,
    },
    req,
  });

  return svc;
};

const deleteService = async (id, req) => {
  const svc = await clinicalServiceRepo.findById(id);
  if (!svc) throw new ServiceError('Không tìm thấy dịch vụ', 404);

  await createAuditLog({
    actorUserId: req?.user?._id,
    actorRole: req?.user?.role,
    action: 'DELETE_CLINICAL_SERVICE',
    displayAction: 'Xóa dịch vụ lâm sàng',
    module: 'clinicalService',
    businessModule: 'clinicalService',
    targetEntityType: 'ClinicalService',
    targetEntityId: svc._id,
    targetName: svc.serviceName,
    description: `Xóa (deactivate) dịch vụ lâm sàng "${svc.serviceName}"`,
    beforeData: { serviceName: svc.serviceName, active: svc.active },
    req,
  });

  svc.active = false;
  await clinicalServiceRepo.saveDoc(svc);
};

module.exports = {
  listServices,
  getService,
  createService,
  updateService,
  deleteService,
  validateFieldThresholds,
};
