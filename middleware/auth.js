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
  if (!req.user) {
    return res.status(403).json({ message: 'Access forbidden: insufficient role' });
  }
  
  // Normalize user role to lowercase for comparison
  const userRole = String(req.user.role || '').toLowerCase();
  
  // Check if user's role matches any of the required roles
  // Support both English and Vietnamese role names
  const normalizedRoles = roles.map(r => r.toLowerCase());
  const isAuthorized = normalizedRoles.some(role => {
    if (role === userRole) return true;
    // Support Vietnamese role names
    if (role === 'nurse' && (userRole.includes('nurse') || userRole.includes('y tá') || userRole.includes('điều dưỡng'))) return true;
    if (role === 'doctor' && (userRole.includes('doctor') || userRole.includes('bác sĩ'))) return true;
    if (role === 'admin' && (userRole.includes('admin') || userRole.includes('quản trị'))) return true;
    if (role === 'family' && (userRole.includes('family') || userRole.includes('gia đình'))) return true;
    if (role === 'manager' && (userRole.includes('manager') || userRole.includes('quản lý'))) return true;
    return false;
  });
  
  if (!isAuthorized) {
    return res.status(403).json({ message: 'Access forbidden: insufficient role' });
  }
  next();
};

module.exports = { protect, optionalProtect, authorize };
