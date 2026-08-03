const jwt = require('jsonwebtoken');
const User = require('../models/user');
//Kiểm tra người dùng đã login chưa và có quyền truy cập vào tài nguyên hay không
const protect = async (req, res, next) => {
  let authHeader = req.headers.authorization;
  let token = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  }

  if (!token && req.query?.token) {
    token = req.query.token.startsWith('Bearer ') ? req.query.token.split(' ')[1] : req.query.token;
  }

  if (!token) {
    return res.status(401).json({ message: 'Chưa xác thực' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-passwordHash -resetPasswordTokenHash');
    if (!user || !user.isActive || user.isBanned) {
      return res.status(401).json({ message: 'Tài khoản đã bị vô hiệu hóa hoặc bị khóa' });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Token không hợp lệ hoặc đã hết hạn' });
  }
};

const optionalProtect = async (req, res, next) => {
  let authHeader = req.headers.authorization;
  let token = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  }

  if (!token && req.query?.token) {
    token = req.query.token.startsWith('Bearer ') ? req.query.token.split(' ')[1] : req.query.token;
  }

  if (!token) {
    return next();
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-passwordHash -resetPasswordTokenHash');
    if (!user || !user.isActive || user.isBanned) {
      return res.status(401).json({ message: 'Tài khoản đã bị vô hiệu hóa hoặc bị khóa' });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Token không hợp lệ hoặc đã hết hạn' });
  }
};

const authorize = (...roles) => (req, res, next) => {
  if (!req.user) {
    return res.status(403).json({ message: 'Truy cập bị từ chối: không đủ quyền' });
  }

  // models/enums.js ROLES only ever stores plain English enum values, so an
  // exact (case-insensitive) match is sufficient — no substring/i18n matching needed.
  const userRole = String(req.user.role || '').toLowerCase();
  const normalizedRoles = roles.map(r => r.toLowerCase());
  const isAuthorized = normalizedRoles.includes(userRole);

  if (!isAuthorized) {
    return res.status(403).json({ message: 'Truy cập bị từ chối: không đủ quyền' });
  }
  next();
};

module.exports = { protect, optionalProtect, authorize };
