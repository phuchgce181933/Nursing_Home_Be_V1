const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

let initialized = false;
let databaseInstance = null;

const isFirebaseEnabled = () => {
  if (process.env.READINESS_SYNC_ENABLED === 'false') return false;
  const hasUrl = Boolean(process.env.FIREBASE_DATABASE_URL);
  const hasCreds =
    Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON) ||
    Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS);
  return hasUrl && hasCreds;
};

/** Load service account JSON so custom tokens are signed locally (private_key). */
const loadServiceAccount = () => {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath) return null;
  const resolved = path.isAbsolute(credPath) ? credPath : path.resolve(process.cwd(), credPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Firebase service account file not found: ${resolved}`);
  }
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
};

const initFirebaseAdmin = () => {
  if (initialized) return admin;
  if (!isFirebaseEnabled()) return null;

  if (!admin.apps.length) {
    const databaseURL = process.env.FIREBASE_DATABASE_URL;
    const serviceAccount = loadServiceAccount();
    if (!serviceAccount) return null;

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL,
    });
  }

  initialized = true;
  return admin;
};

const getDatabase = () => {
  const app = initFirebaseAdmin();
  if (!app) return null;
  if (!databaseInstance) {
    databaseInstance = admin.database();
  }
  return databaseInstance;
};

const getAuth = () => {
  const app = initFirebaseAdmin();
  if (!app) return null;
  return admin.auth();
};

module.exports = {
  isFirebaseEnabled,
  getDatabase,
  getAuth,
  admin,
};
