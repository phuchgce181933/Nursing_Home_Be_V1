const PushToken = require('../models/pushToken');

// A token belongs to whichever user last registered it (a device can be re-logged-in as a
// different user), so registering always upserts by token, re-pointing userId if needed.
const upsertToken = async (userId, token, platform) =>
  PushToken.findOneAndUpdate(
    { token },
    { userId, token, platform: platform || 'unknown', lastSeenAt: new Date() },
    { new: true, upsert: true }
  );

const removeToken = async (token, userId) => PushToken.deleteOne(userId ? { token, userId } : { token });

const removeTokens = async (tokens) => PushToken.deleteMany({ token: { $in: tokens } });

const findTokensByUserIds = async (userIds) =>
  PushToken.find({ userId: { $in: userIds } }).select('userId token');

module.exports = {
  upsertToken,
  removeToken,
  removeTokens,
  findTokensByUserIds,
};
