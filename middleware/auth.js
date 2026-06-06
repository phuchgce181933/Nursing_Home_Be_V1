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
    return res.status(401).json({ message: 'Not authenticated' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-passwordHash -resetPasswordTokenHash');
    if (!user || !user.isActive || user.isBanned) {
      return res.status(401).json({ message: 'Account is inactive or banned' });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token' });
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
      return res.status(401).json({ message: 'Account is inactive or banned' });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};

const authorize = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ message: 'Access forbidden: insufficient role' });
  }
  next();
};

module.exports = { protect, optionalProtect, authorize };
