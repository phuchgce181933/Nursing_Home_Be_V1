
// module.exports = connectDB;
require('dotenv').config();
const mongoose = require('mongoose');

const connectDB = async () => {
  try {

    // chọn local hoặc atlas
    const uri =
      process.env.NODE_ENV === 'local'
        ? process.env.MONGO_URI_LOCAL
        : process.env.MONGO_URI;

    await mongoose.connect(uri);

    console.log('MongoDB connected:', uri);
    
  } catch (err) {
    console.error('MongoDB connection failed:', err.message);
    throw err;
  }
};

module.exports = connectDB;
// sử dụng lệnh này để chạy local: npm run dev:local
// sử dụng lệnh này để chạy atlas: npm run dev
