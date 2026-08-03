// One-time build step: uploads the logo + generated icon PNGs to Cloudinary
// (already used elsewhere in this project) and writes their permanent HTTPS
// URLs to assets/email/hosted-urls.json. Email templates reference these
// hosted URLs instead of CID attachments — CID inline images make Gmail
// list every one of them in the "N attachments" tray at the bottom of the
// email (confirmed by a real send), which looks unprofessional. A normal
// <img src="https://..."> is not a MIME attachment, so nothing shows there.
//
// Run manually whenever a logo/icon asset changes:
//   node scripts/upload-email-assets.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const cloudinary = require('../config/cloudinaryConfig');
const { LOGO_ATTACHMENT, ICON_ATTACHMENTS } = require('../utils/emailBrand');

const FOLDER = 'nursing-home/email-assets';
const MANIFEST_PATH = path.join(__dirname, '..', 'assets', 'email', 'hosted-urls.json');

const uploadPng = async (filePath, publicId) => {
  const buffer = fs.readFileSync(filePath);
  const dataUri = `data:image/png;base64,${buffer.toString('base64')}`;
  const result = await cloudinary.uploader.upload(dataUri, {
    folder: FOLDER,
    public_id: publicId,
    resource_type: 'image',
    format: 'png', // keep PNG (not webp) — widest mail-client support
    overwrite: true,
  });
  return result.secure_url;
};

(async () => {
  if (!cloudinary.isCloudinaryConfigured()) {
    throw new Error('Cloudinary is not configured (CLOUDINARY_* env vars missing).');
  }
  cloudinary.ensureCloudinaryEnv();

  const manifest = {};

  console.log('Uploading logo...');
  manifest[LOGO_ATTACHMENT.cid] = await uploadPng(LOGO_ATTACHMENT.path, LOGO_ATTACHMENT.cid);
  console.log('  ->', manifest[LOGO_ATTACHMENT.cid]);

  for (const att of ICON_ATTACHMENTS) {
    console.log('Uploading', att.filename, '...');
    manifest[att.cid] = await uploadPng(att.path, att.cid);
    console.log('  ->', manifest[att.cid]);
  }

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log(`\nWrote ${Object.keys(manifest).length} URLs to ${MANIFEST_PATH}`);
})().catch((err) => {
  console.error('FAILED:', err.message || err);
  process.exit(1);
});
