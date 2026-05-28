const authService = require('../services/authService');

const login = async (req, res) => {
  try {
    const result = await authService.login(req.body);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getMe = async (req, res) => {
  try {
    const result = await authService.getMe(req.user);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const createStaffAccount = async (req, res) => {
  try {
    const result = await authService.createStaffAccount(req.body, req.user);
    res.status(201).json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const listStaffAccounts = async (req, res) => {
  try {
    const result = await authService.listStaffAccounts(req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const toggleStaffActive = async (req, res) => {
  try {
    const result = await authService.toggleStaffActive(req.params.id, req.user);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

// update profile
const updateProfile = async (req, res) => {
  try {
    const result = await authService.updateProfile(req.user, req.body);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({
      message: err.message,
    });
  }
};

// doi pass
const changePassword = async (req, res) => {
  try {
    const result = await authService.changePassword(req.user, req.body);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({
      message: err.message,
    });
  }
};

// forgot password
const forgotPassword = async (req, res) => {
  try {
    const result = await authService.forgotPassword(req.body);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({
      message: err.message,
    });
  }
};

// reset password
const resetPassword = async (req, res) => {
  try {
    const result = await authService.resetPassword(req.body);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({
      message: err.message,
    });
  }
};

// update user by admin
const updateUserByAdmin = async (req, res) => {
  try {
    const result = await authService.updateUserByAdmin(req.params.id, req.body);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({
      message: err.message,
    });
  }
};

const createFirebaseToken = async (req, res) => {
  try {
    const result = await authService.createFirebaseCustomToken(req.user);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

module.exports = {
  login,
  getMe,
  createStaffAccount,
  listStaffAccounts,
  toggleStaffActive,
  updateProfile,
  changePassword,
  forgotPassword,
  resetPassword,
  updateUserByAdmin,
  createFirebaseToken,
};
