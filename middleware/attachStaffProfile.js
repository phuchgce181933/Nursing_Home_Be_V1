const staffProfileRepo = require('../repositories/staffProfileRepository');

const ROLES_REQUIRING_PROFILE = ['doctor', 'nurse'];

const attachStaffProfile = async (req, res, next) => {
  try {
    if (req.user && ROLES_REQUIRING_PROFILE.includes(req.user.role)) {
      const profile = await staffProfileRepo.findByUserId(req.user._id);
      if (!profile) {
        return res.status(403).json({ message: 'Staff profile not found for this account. Contact admin.' });
      }
      req.staffProfile = profile;
    } else {
      req.staffProfile = null;
    }
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = { attachStaffProfile };
