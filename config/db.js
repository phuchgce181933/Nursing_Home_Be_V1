
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

    // Log only non-secret connection info. NEVER log the full URI: it embeds the
    // Atlas username/password. host + db name are enough to confirm the target.
    const { host, port, name } = mongoose.connection;
    console.log(`MongoDB connected: host=${host}${port ? ':' + port : ''} db=${name}`);

  } catch (err) {
    console.error('MongoDB connection failed:', err.message);
    throw err;
  }
};

module.exports = connectDB;
// sử dụng lệnh này để chạy local: npm run dev:local
// sử dụng lệnh này để chạy atlas: npm run dev
