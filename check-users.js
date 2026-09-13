require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/user');
const bcrypt = require('bcryptjs');

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  // Get an admin user
  const users = await User.find({ role: 'admin' }).limit(3);
  for (const u of users) {
    console.log('Admin user:', u.email, 'isActive:', u.isActive, 'isBanned:', u.isBanned);
  }
  
  // Try to find a test user
  const testUsers = await User.find({ email: /test/i }).limit(5);
  for (const u of testUsers) {
    console.log('Test user:', u.email, 'role:', u.role);
  }
  
  await mongoose.disconnect();
}
main().catch(console.error);
