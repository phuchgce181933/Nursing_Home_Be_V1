const sharp = require('sharp');
const cloudinary = require('../config/cloudinaryConfig');

const isCloudinaryConfigured = cloudinary.isCloudinaryConfigured;
const ensureCloudinaryEnv = cloudinary.ensureCloudinaryEnv;

const extractCloudinaryErrorMessage = (err) => {
  if (!err) return 'Unknown upload error';
  if (typeof err === 'string') return err;
  if (typeof err.message === 'string' && err.message) return err.message;
  if (typeof err.error === 'string' && err.error) return err.error;
  if (err.error?.message) return String(err.error.message);
  if (err.name && err.http_code) return `${err.name} (HTTP ${err.http_code})`;
  try {
    const raw = JSON.stringify(err.error || err);
    return raw.length > 200 ? `${raw.slice(0, 200)}...` : raw;
  } catch {
    return 'Unknown Cloudinary upload error';
  }
};

const mapCloudinaryError = (err) => {
  const message = extractCloudinaryErrorMessage(err);
  if (
    message.includes('unable to verify the first certificate') ||
    message.includes('UNABLE_TO_VERIFY_LEAF_SIGNATURE') ||
    message.includes('self signed certificate')
  ) {
    return 'Không thể kết nối Cloudinary (lỗi chứng chỉ SSL). Trên môi trường local, thêm CLOUDINARY_INSECURE_SSL=true vào .env';
  }
  if (message.includes('Invalid cloud_name') || message.includes('Must supply')) {
    return 'Cloudinary chưa được cấu hình. Kiểm tra CLOUDINARY_* trong file .env';
  }
  return message;
};

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

const uploadImageBuffer = async (buffer, { folder, mimeType = 'image/webp', options = {} } = {}) => {
  ensureCloudinaryEnv();

  if (!isCloudinaryConfigured()) {
    throw new Error('Cloudinary chưa được cấu hình. Kiểm tra CLOUDINARY_* trong file .env');
  }

  const optimized = await optimizeImage(buffer);
  const dataUri = `data:${mimeType};base64,${optimized.toString('base64')}`;

  try {
    const result = await cloudinary.uploader.upload(dataUri, {
      folder,
      resource_type: 'image',
      quality: 'auto',
      fetch_format: 'auto',
      ...options,
    });
    if (!result?.secure_url) {
      throw new Error('Cloudinary upload returned no secure_url');
    }
    return result;
  } catch (err) {
    console.error('[Cloudinary] upload failed:', err);
    throw new Error(mapCloudinaryError(err));
  }
};

const uploadRawBuffer = async (buffer, { folder, mimeType = 'application/octet-stream', options = {} } = {}) => {
  ensureCloudinaryEnv();

  if (!isCloudinaryConfigured()) {
    throw new Error('Cloudinary chưa được cấu hình. Kiểm tra CLOUDINARY_* trong file .env');
  }

  const dataUri = `data:${mimeType};base64,${buffer.toString('base64')}`;

  try {
    const result = await cloudinary.uploader.upload(dataUri, {
      folder,
      resource_type: 'auto',
      ...options,
    });
    if (!result?.secure_url) {
      throw new Error('Cloudinary upload returned no secure_url');
    }
    return result;
  } catch (err) {
    console.error('[Cloudinary] upload failed:', err);
    throw new Error(mapCloudinaryError(err));
  }
};

module.exports = {
  isCloudinaryConfigured,
  mapCloudinaryError,
  extractCloudinaryErrorMessage,
  uploadImageBuffer,
  uploadRawBuffer,
};
