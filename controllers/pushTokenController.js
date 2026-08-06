const pushTokenRepo = require('../repositories/pushTokenRepository');

const registerPushToken = async (req, res) => {
  try {
    const { token, platform } = req.body;
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ message: 'token là bắt buộc' });
    }
    if (platform && !['ios', 'android', 'web'].includes(platform)) {
      return res.status(400).json({ message: 'platform phải là ios, android, hoặc web' });
    }
    await pushTokenRepo.upsertToken(req.user._id, token.trim(), platform);
    return res.json({ success: true });
  } catch (err) {
    console.error('registerPushToken error:', err);
    return res.status(500).json({ message: 'Không thể đăng ký push token' });
  }
};

const unregisterPushToken = async (req, res) => {
  try {
    const { token } = req.body;
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ message: 'token là bắt buộc' });
    }
    await pushTokenRepo.removeToken(token.trim(), req.user._id);
    return res.json({ success: true });
  } catch (err) {
    console.error('unregisterPushToken error:', err);
    return res.status(500).json({ message: 'Không thể hủy đăng ký push token' });
  }
};

module.exports = { registerPushToken, unregisterPushToken };
