const staffProfileRepo = require('../repositories/staffProfileRepository');

const getResidentScope = async (userId, role) => {
  if (['admin'].includes(role)) return null;
  const profile = await staffProfileRepo.findByUserId(userId);
  if (!profile) return [];
  return profile.assignedResidentIds.map(String);
};

const isInScope = (residentId, scope) =>
  scope === null || scope.includes(String(residentId));

module.exports = { getResidentScope, isInScope };
