const staffProfileRepo = require('../repositories/staffProfileRepository');

const ROLES_REQUIRING_PROFILE = ['doctor', 'nurse'];

const attachStaffProfile = async (req, res, next) => {
  try {
    if (req.user && ROLES_REQUIRING_PROFILE.includes(req.user.role)) {
      const profile = await staffProfileRepo.findByUserId(req.user._id);
      if (!profile) {
        return res.status(403).json({ message: 'Không tìm thấy hồ sơ nhân viên cho tài khoản này. Vui lòng liên hệ quản trị viên.' });
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
