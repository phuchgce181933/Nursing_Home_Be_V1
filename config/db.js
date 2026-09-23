
// module.exports = connectDB;
require('dotenv').config();
const mongoose = require('mongoose');
const dns = require('dns');

const connectDB = async () => {
  try {

    // Opt-in DNS override for machines whose local resolver refuses SRV lookups
    // (mongodb+srv then fails with `querySrv ECONNREFUSED`). No effect unless
    // DNS_SERVERS is set, so production behavior is unchanged.
    // e.g. in .env:  DNS_SERVERS=8.8.8.8,1.1.1.1
    if (process.env.DNS_SERVERS) {
      dns.setServers(
        process.env.DNS_SERVERS.split(',').map((s) => s.trim()).filter(Boolean),
      );
    }

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
