const ServiceError = require('./serviceError');
const servicePackageRepo = require('../repositories/servicePackageRepository');
const { SERVICE_PACKAGE_TIERS } = require('../models/enums');
const { createAuditLog } = require('../utils/auditLog');

const parsePagination = (query) => {
  const pageNum = Math.max(1, parseInt(query.page || 1, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(query.limit || 20, 10)));
  const skip = (pageNum - 1) * limitNum;
  return { pageNum, limitNum, skip };
};

const generatePackageCode = async () => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = `PKG${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
    const exists = await servicePackageRepo.findByCode(code);
    if (!exists) return code;
  }
  throw new ServiceError('Unable to generate package code', 500);
};

const TIER_ROOM_TYPES_MAP = {
  basic: ['standard'],
  standard: ['standard'],
  premium: ['premium'],
  vip: ['icu', 'isolation'],
};

const resolveAllowedRoomTypes = (tier, inputTypes) => {
  if (Array.isArray(inputTypes) && inputTypes.length > 0) {
    const valid = inputTypes.filter((t) => ['standard', 'premium', 'icu', 'isolation'].includes(t));
    if (valid.length > 0) return valid;
  }
  return TIER_ROOM_TYPES_MAP[tier] || ['standard'];
};

const formatPackage = (pkg) => ({
  _id: pkg._id,
  packageCode: pkg.packageCode,
  name: pkg.name,
  description: pkg.description,
  tier: pkg.tier,
  allowedRoomTypes: pkg.allowedRoomTypes?.length ? pkg.allowedRoomTypes : (TIER_ROOM_TYPES_MAP[pkg.tier] || ['standard']),
  services: pkg.services,
  monthlyPrice: pkg.monthlyPrice,
  isActive: pkg.isActive,
  createdBy: pkg.createdBy?._id
    ? { _id: pkg.createdBy._id, fullName: pkg.createdBy.fullName, email: pkg.createdBy.email }
    : pkg.createdBy || null,
  updatedBy: pkg.updatedBy?._id
    ? { _id: pkg.updatedBy._id, fullName: pkg.updatedBy.fullName, email: pkg.updatedBy.email }
    : pkg.updatedBy || null,
  createdAt: pkg.createdAt,
  updatedAt: pkg.updatedAt,
});

// ── UC-6.20: Create Service Package ─────────────────────────────────────────────
const createServicePackage = async (admin, body, req) => {
  if (!body || typeof body !== 'object' || Object.keys(body).length === 0) {
    throw new ServiceError('Request body is empty', 400);
  }

  const name = body.name?.trim();
  if (!name) {
    throw new ServiceError('name is required', 400);
  }

  if (body.tier && !SERVICE_PACKAGE_TIERS.includes(body.tier)) {
    throw new ServiceError(`tier must be one of: ${SERVICE_PACKAGE_TIERS.join(', ')}`, 400);
  }

  if (body.monthlyPrice != null && (typeof body.monthlyPrice !== 'number' || body.monthlyPrice < 0)) {
    throw new ServiceError('monthlyPrice must be a non-negative number', 400);
  }

  const services = Array.isArray(body.services)
    ? body.services.map((s) => String(s).trim()).filter(Boolean)
    : [];

  const packageCode = await generatePackageCode();

  // Anti-spam: Kiểm tra gói dịch vụ trùng tên (case-insensitive)
  const existingByName = await servicePackageRepo.findByName(name);
  if (existingByName) {
    throw new ServiceError(
      `Một gói dịch vụ đang hoạt động với tên '${existingByName.name}' (${existingByName.packageCode}) đã tồn tại. Vui lòng dùng tên khác hoặc cập nhật gói hiện có.`,
      409
    );
  }

  const tier = body.tier || 'standard';
  const allowedRoomTypes = resolveAllowedRoomTypes(tier, body.allowedRoomTypes);

  const pkg = await servicePackageRepo.create({
    packageCode,
    name,
    description: body.description?.trim(),
    tier,
    allowedRoomTypes,
    services,
    monthlyPrice: body.monthlyPrice || 0,
    createdBy: admin._id,
    updatedBy: admin._id,
  });

  await createAuditLog({
    actorUserId: admin._id,
    actorRole: admin.role,
    action: 'CREATE_SERVICE_PACKAGE',
    module: 'servicePackage',
    targetEntityType: 'ServicePackage',
    targetEntityId: pkg._id,
    afterData: { packageCode: pkg.packageCode, name: pkg.name, tier: pkg.tier, allowedRoomTypes },
    req,
  });

  return { message: 'Service package created successfully', servicePackage: formatPackage(pkg) };
};

// ── UC-6.21: Update Service Package ─────────────────────────────────────────────
const updateServicePackage = async (admin, packageId, body, req) => {
  const pkg = await servicePackageRepo.findById(packageId);
  if (!pkg) {
    throw new ServiceError('Service package not found', 404);
  }

  if (body.tier && !SERVICE_PACKAGE_TIERS.includes(body.tier)) {
    throw new ServiceError(`tier must be one of: ${SERVICE_PACKAGE_TIERS.join(', ')}`, 400);
  }

  if (body.monthlyPrice != null && (typeof body.monthlyPrice !== 'number' || body.monthlyPrice < 0)) {
    throw new ServiceError('monthlyPrice must be a non-negative number', 400);
  }

  const updateData = { updatedBy: admin._id };
  if (body.name) {
    const newName = String(body.name).trim();
    // Kiểm tra tên mới có bị trùng với gói khác không
    const existingByName = await servicePackageRepo.findByName(newName, packageId);
    if (existingByName) {
      throw new ServiceError(
        `Một gói dịch vụ đang hoạt động với tên '${existingByName.name}' (${existingByName.packageCode}) đã tồn tại. Vui lòng dùng tên khác.`,
        409
      );
    }
    updateData.name = newName;
  }
  if (body.description !== undefined) updateData.description = String(body.description).trim();
  if (body.tier || body.allowedRoomTypes) {
    const newTier = body.tier || pkg.tier;
    updateData.tier = newTier;
    updateData.allowedRoomTypes = resolveAllowedRoomTypes(newTier, body.allowedRoomTypes);
  }
  if (body.monthlyPrice != null) updateData.monthlyPrice = body.monthlyPrice;
  if (Array.isArray(body.services)) {
    updateData.services = body.services.map((s) => String(s).trim()).filter(Boolean);
  }

  const beforeData = { name: pkg.name, tier: pkg.tier, monthlyPrice: pkg.monthlyPrice };
  const updated = await servicePackageRepo.updateById(packageId, updateData);

  await createAuditLog({
    actorUserId: admin._id,
    actorRole: admin.role,
    action: 'UPDATE_SERVICE_PACKAGE',
    module: 'servicePackage',
    targetEntityType: 'ServicePackage',
    targetEntityId: pkg._id,
    beforeData,
    afterData: { name: updated.name, tier: updated.tier, monthlyPrice: updated.monthlyPrice },
    req,
  });

  return { message: 'Service package updated successfully', servicePackage: formatPackage(updated) };
};

// ── UC-6.22: Delete Service Package (soft) ──────────────────────────────────────
const deleteServicePackage = async (admin, packageId, req) => {
  const pkg = await servicePackageRepo.findById(packageId);
  if (!pkg) {
    throw new ServiceError('Service package not found', 404);
  }

  if (!pkg.isActive) {
    throw new ServiceError('Service package is already deleted', 400);
  }

  const updated = await servicePackageRepo.softDelete(packageId, admin._id);

  await createAuditLog({
    actorUserId: admin._id,
    actorRole: admin.role,
    action: 'DELETE_SERVICE_PACKAGE',
    module: 'servicePackage',
    targetEntityType: 'ServicePackage',
    targetEntityId: pkg._id,
    beforeData: { isActive: true },
    afterData: { isActive: false },
    req,
  });

  return { message: 'Service package deleted successfully', servicePackage: formatPackage(updated) };
};

// ── UC-6.23: List Service Packages ──────────────────────────────────────────────
const listServicePackages = async (query) => {
  const filter = {};

  if (query.isActive !== undefined) {
    filter.isActive = query.isActive === 'true' || query.isActive === true;
  }

  if (query.tier) {
    if (!SERVICE_PACKAGE_TIERS.includes(query.tier)) {
      throw new ServiceError(`tier must be one of: ${SERVICE_PACKAGE_TIERS.join(', ')}`, 400);
    }
    filter.tier = query.tier;
  }

  if (query.search) {
    const term = query.search.trim();
    filter.$or = [
      { name: { $regex: term, $options: 'i' } },
      { packageCode: { $regex: term, $options: 'i' } },
      { description: { $regex: term, $options: 'i' } },
    ];
  }

  const { pageNum, limitNum, skip } = parsePagination(query);
  const sort = { createdAt: -1 };

  const [data, total] = await Promise.all([
    servicePackageRepo.findAll(filter, { sort, skip, limit: limitNum }),
    servicePackageRepo.countAll(filter),
  ]);

  return {
    data: data.map(formatPackage),
    total,
    page: pageNum,
    limit: limitNum,
    totalPages: Math.ceil(total / limitNum) || 1,
  };
};

// ── UC-6.27: Get Service Package detail ─────────────────────────────────────────
const getServicePackage = async (packageId) => {
  const pkg = await servicePackageRepo.findById(packageId);
  if (!pkg) {
    throw new ServiceError('Service package not found', 404);
  }
  return { servicePackage: formatPackage(pkg) };
};

module.exports = {
  createServicePackage,
  updateServicePackage,
  deleteServicePackage,
  listServicePackages,
  getServicePackage,
};
