const multer = require('multer');
const {
  isCloudinaryConfigured,
  mapCloudinaryError,
  uploadImageBuffer,
  uploadRawBuffer,
} = require('../utils/cloudinaryUpload');

const ALLOWED_IMAGE_MIMES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const ALLOWED_CERTIFICATION_MIMES = ALLOWED_IMAGE_MIMES;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
});

const needsCloudinary = (req) =>
  Boolean(req.file || req.files?.avatar?.[0] || req.files?.certificationFiles?.length);

const assertCloudinaryReady = () => {
  if (!isCloudinaryConfigured()) {
    throw new Error('Cloudinary chưa được cấu hình. Kiểm tra CLOUDINARY_* trong file .env');
  }
};

const handleUploadError = (error) => {
  if (error?.message && !error.message.includes('[object Object]')) {
    return error.message;
  }
  return mapCloudinaryError(error);
};

const uploadToCloudinary = async (buffer, folder, options = {}) =>
  uploadImageBuffer(buffer, { folder, options });

const uploadRawFileToCloudinary = async (buffer, folder, options = {}) =>
  uploadRawBuffer(buffer, { folder, options });

const uploadAvatar = (req, res, next) => {
  const handler = upload.single('avatar');
  handler(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ message: err.message });
    }
    if (err) {
      return res.status(400).json({ message: err.message });
    }
    try {
      if (req.file) {
        if (!ALLOWED_IMAGE_MIMES.includes(req.file.mimetype)) {
          return res.status(400).json({
            message: 'Avatar must be an image file (jpg, png, webp)',
          });
        }
        assertCloudinaryReady();
        const result = await uploadImageBuffer(req.file.buffer, {
          folder: 'nursing-home/avatars',
          mimeType: req.file.mimetype,
        });
        req.body.avatarUrl = result.secure_url;
        req.body.avatarPublicId = result.public_id;
      }
      return next();
    } catch (error) {
      return res.status(500).json({ message: 'Image upload failed: ' + handleUploadError(error) });
    }
  });
};

const uploadAvatarAndCertifications = (req, res, next) => {
  const handler = upload.fields([
    { name: 'avatar', maxCount: 1 },
    { name: 'certificationFiles', maxCount: 5 },
  ]);

  handler(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ message: err.message });
    }
    if (err) {
      return res.status(400).json({ message: err.message });
    }

    try {
      if (needsCloudinary(req)) {
        assertCloudinaryReady();
      }

      if (req.files?.avatar?.[0]) {
        const avatarFile = req.files.avatar[0];
        if (!ALLOWED_IMAGE_MIMES.includes(avatarFile.mimetype)) {
          return res.status(400).json({ message: 'Avatar must be an image file (jpg, png, webp)' });
        }
        const result = await uploadImageBuffer(avatarFile.buffer, {
          folder: 'nursing-home/avatars',
          mimeType: avatarFile.mimetype,
        });
        req.body.avatarUrl = result.secure_url;
        req.body.avatarPublicId = result.public_id;
      }

      if (req.files?.certificationFiles?.length) {
        const documents = [];
        for (const file of req.files.certificationFiles) {
          if (!ALLOWED_CERTIFICATION_MIMES.includes(file.mimetype)) {
            return res.status(400).json({
              message: 'Chứng chỉ phải là file ảnh (jpg, png, webp)',
            });
          }
          const result = await uploadImageBuffer(file.buffer, {
            folder: 'nursing-home/certifications',
            mimeType: file.mimetype,
          });
          documents.push({
            url: result.secure_url,
            publicId: result.public_id,
            fileName: file.originalname,
            mimeType: file.mimetype,
            uploadedAt: new Date(),
          });
        }
        req.body.certificationDocuments = documents;
      }

      return next();
    } catch (error) {
      return res.status(500).json({ message: 'Upload failed: ' + handleUploadError(error) });
    }
  });
};

module.exports = { uploadAvatar, uploadAvatarAndCertifications, uploadToCloudinary, uploadRawFileToCloudinary };
