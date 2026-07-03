const cloudinary = require('cloudinary').v2;

let sslWarningLogged = false;

const getCredentials = () => ({
  cloudName: process.env.CLOUD_NAME || process.env.CLOUDINARY_CLOUD_NAME,
  apiKey: process.env.API_KEY || process.env.CLOUDINARY_API_KEY,
  apiSecret: process.env.API_SECRET || process.env.CLOUDINARY_API_SECRET,
});

const isCloudinaryConfigured = () => {
  const { cloudName, apiKey, apiSecret } = getCredentials();
  return Boolean(cloudName && apiKey && apiSecret);
};

const applyLocalSslWorkaround = () => {
  const insecureSsl =
    process.env.NODE_ENV === 'local' &&
    String(process.env.CLOUDINARY_INSECURE_SSL ?? 'true').toLowerCase() !== 'false';

  if (!insecureSsl) return;

  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  if (!sslWarningLogged) {
    sslWarningLogged = true;
    console.warn(
      '[Cloudinary] CLOUDINARY_INSECURE_SSL=true — TLS certificate verification disabled. Use only for local development.'
    );
  }
};

const ensureCloudinaryEnv = () => {
  applyLocalSslWorkaround();
  const { cloudName, apiKey, apiSecret } = getCredentials();
  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
  });
};

if (!isCloudinaryConfigured()) {
  console.warn(
    'Cloudinary not fully configured. Expected env keys: CLOUD_NAME/API_KEY/API_SECRET or CLOUDINARY_CLOUD_NAME/CLOUDINARY_API_KEY/CLOUDINARY_API_SECRET'
  );
}

applyLocalSslWorkaround();
ensureCloudinaryEnv();

module.exports = cloudinary;
module.exports.isCloudinaryConfigured = isCloudinaryConfigured;
module.exports.ensureCloudinaryEnv = ensureCloudinaryEnv;
