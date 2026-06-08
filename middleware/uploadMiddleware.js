const multer = require('multer');
const sharp = require('sharp');
const { Readable } = require('stream');
const cloudinary = require('../config/cloudinaryConfig');

const ALLOWED_IMAGE_MIMES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const ALLOWED_CERTIFICATION_MIMES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
});

const optimizeImage = async (buffer) => {
  try {
    return await sharp(buffer)
      .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();
  } catch {
    return buffer;
  }
};

const uploadToCloudinary = async (buffer, folder, options = {}) => {
  const optimized = await optimizeImage(buffer);
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image', quality: 'auto', fetch_format: 'auto', ...options },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    const readable = new Readable();
    readable.push(optimized);
    readable.push(null);
    readable.pipe(stream);
  });
};

const uploadRawFileToCloudinary = async (buffer, folder, options = {}) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'auto', ...options },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    const readable = new Readable();
    readable.push(buffer);
    readable.push(null);
    readable.pipe(stream);
  });

// Middleware for uploading a single avatar image (field name: "avatar")
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
        const result = await uploadToCloudinary(req.file.buffer, 'nursing-home/avatars');
        req.body.avatarUrl = result.secure_url;
        req.body.avatarPublicId = result.public_id;
      }
      return next();
    } catch (error) {
      return res.status(500).json({ message: 'Image upload failed: ' + error.message });
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
      if (req.files?.avatar?.[0]) {
        const avatarFile = req.files.avatar[0];
        if (!ALLOWED_IMAGE_MIMES.includes(avatarFile.mimetype)) {
          return res.status(400).json({ message: 'Avatar must be an image file (jpg, png, webp)' });
        }
        const result = await uploadToCloudinary(avatarFile.buffer, 'nursing-home/avatars');
        req.body.avatarUrl = result.secure_url;
        req.body.avatarPublicId = result.public_id;
      }

      if (req.files?.certificationFiles?.length) {
        const documents = [];
        for (const file of req.files.certificationFiles) {
          if (!ALLOWED_CERTIFICATION_MIMES.includes(file.mimetype)) {
            return res.status(400).json({
              message: 'Chứng chỉ phải là file PDF, DOC hoặc DOCX',
            });
          }
          const result = await uploadRawFileToCloudinary(file.buffer, 'nursing-home/certifications');
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
      return res.status(500).json({ message: 'Upload failed: ' + error.message });
    }
  });
};

module.exports = { uploadAvatar, uploadAvatarAndCertifications, uploadToCloudinary, uploadRawFileToCloudinary };
