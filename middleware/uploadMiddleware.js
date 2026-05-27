const multer = require('multer');
const sharp = require('sharp');
const { Readable } = require('stream');
const cloudinary = require('../config/cloudinaryConfig');

const ALLOWED_IMAGE_MIMES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
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

module.exports = { uploadAvatar, uploadToCloudinary };
