let Expo;

const initExpo = async () => {
  if (!Expo) {
    const module = await import('expo-server-sdk');
    Expo = module.Expo;
  }
  return Expo;
};

const pushTokenRepo = require('../repositories/pushTokenRepository');
const userRepo = require('../repositories/userRepository');

// Sends `{title, body, data}` as a push notification to every device token registered for
// each of `recipientUserIds`, skipping users who have doNotDisturb on or who excluded this
// category via their notification settings. Best-effort: failures are logged, never thrown —
// push delivery must never block the (already-persisted) in-app notification it accompanies.
const sendPushToUsers = async (recipientUserIds, { title, body, data = {}, category } = {}) => {
  try {
    const ExpoClass = await initExpo();
    const expo = new ExpoClass();

    const ids = [...new Set((recipientUserIds || []).map(String))];
    if (!ids.length) return;

    const users = await userRepo.findByIdsWithSelect(ids, 'notificationSettings');
    const allowedUserIds = users
      .filter((u) => {
        const settings = u.notificationSettings || {};
        if (settings.doNotDisturb) return false;
        if (category && Array.isArray(settings.enabledCategories) && settings.enabledCategories.length > 0) {
          return settings.enabledCategories.includes(category);
        }
        return true;
      })
      .map((u) => String(u._id));
    if (!allowedUserIds.length) return;

    const tokenDocs = await pushTokenRepo.findTokensByUserIds(allowedUserIds);
    if (!tokenDocs.length) return;

    const messages = [];
    for (const doc of tokenDocs) {
      if (!ExpoClass.isExpoPushToken(doc.token)) continue;
      messages.push({
        to: doc.token,
        sound: 'default',
        title: title || 'Thông báo',
        body: body || '',
        data,
      });
    }
    if (!messages.length) return;

    const chunks = expo.chunkPushNotifications(messages);
    const invalidTokens = [];
    for (const chunk of chunks) {
      try {
        const receipts = await expo.sendPushNotificationsAsync(chunk);
        receipts.forEach((receipt, i) => {
          if (receipt.status === 'error' && receipt.details?.error === 'DeviceNotRegistered') {
            invalidTokens.push(chunk[i].to);
          }
        });
      } catch (err) {
        console.warn('[pushNotificationService] chunk send failed:', err.message);
      }
    }
    if (invalidTokens.length) {
      await pushTokenRepo.removeTokens(invalidTokens).catch(() => {});
    }
  } catch (err) {
    console.warn('[pushNotificationService] sendPushToUsers failed:', err.message);
  }
};

module.exports = { sendPushToUsers };
