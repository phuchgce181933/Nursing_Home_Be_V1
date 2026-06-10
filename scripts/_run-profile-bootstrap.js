process.env.NODE_ENV = process.env.NODE_ENV || 'local';
const connectDB = require('../config/db');
const mongoose = require('mongoose');
const { ensureStaffProfilesForAssignableUsers } = require('../services/staffProfileBootstrap');

(async () => {
  await connectDB();
  const result = await ensureStaffProfilesForAssignableUsers();
  console.log('result:', result);
  await mongoose.disconnect();
})();
