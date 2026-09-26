const ServiceError = require('./serviceError');
const residentRepo = require('../repositories/residentRepository');
const { assertResidentAccess } = require('./familyPortalService');
const { assertResidentsAssignedToUser } = require('./assignedResidentService');
const { deleteAsset } = require('../utils/cloudinaryUpload');

const formatPhoto = (photo) => ({
  _id: photo._id,
  url: photo.url,
  caption: photo.caption,
  uploadedAt: photo.uploadedAt,
});

// ── Caregiver: add photos ────────────────────────────────────────────────────
const addPhotos = async (userId, residentId, uploadedPhotos, caption) => {
  await assertResidentsAssignedToUser(userId, [residentId]);

  if (!uploadedPhotos || !uploadedPhotos.length) {
    throw new ServiceError('Phải cung cấp ít nhất một ảnh', 400);
  }

  const resident = await residentRepo.findById(residentId);
  if (!resident) throw new ServiceError('Không tìm thấy cư dân', 404);

  const entries = uploadedPhotos.map((p) => ({
    url: p.url,
    publicId: p.publicId,
    caption: caption?.trim() || undefined,
    uploadedBy: userId,
    uploadedAt: new Date(),
  }));

  resident.photos.push(...entries);
  await resident.save();

  return resident.photos.slice(-entries.length).map(formatPhoto);
};

// ── Caregiver: list photos for a resident they're assigned to ──────────────────
const listPhotosForCaregiver = async (userId, residentId) => {
  await assertResidentsAssignedToUser(userId, [residentId]);
  const resident = await residentRepo.findById(residentId);
  if (!resident) throw new ServiceError('Không tìm thấy cư dân', 404);
  return resident.photos.slice().reverse().map(formatPhoto);
};

// ── Caregiver: delete a photo ────────────────────────────────────────────────
const deletePhoto = async (userId, residentId, photoId) => {
  await assertResidentsAssignedToUser(userId, [residentId]);

  const resident = await residentRepo.findById(residentId);
  if (!resident) throw new ServiceError('Không tìm thấy cư dân', 404);

  const target = resident.photos.find((p) => String(p._id) === String(photoId));
  if (!target) {
    throw new ServiceError('Không tìm thấy ảnh', 404);
  }

  resident.photos = resident.photos.filter((p) => String(p._id) !== String(photoId));
  await resident.save();

  await deleteAsset(target.publicId);

  return { deleted: true };
};

// ── Family: view photos for their relative ──────────────────────────────────────
const listPhotosForFamily = async (user, residentId) => {
  if (!(await assertResidentAccess(user._id, residentId))) {
    throw new ServiceError('Từ chối truy cập: không phải người thân của bạn', 403);
  }
  const resident = await residentRepo.findById(residentId);
  if (!resident) throw new ServiceError('Không tìm thấy cư dân', 404);
  return resident.photos.slice().reverse().map(formatPhoto);
};

module.exports = {
  addPhotos,
  listPhotosForCaregiver,
  deletePhoto,
  listPhotosForFamily,
};
