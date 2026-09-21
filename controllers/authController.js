const authService = require('../services/authService');
const { sendApiError } = require('../utils/apiErrorResponse');

const login = async (req, res) => {
  try {
    const result = await authService.login(req.body);
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

const getMe = async (req, res) => {
  try {
    const result = await authService.getMe(req.user);
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

const createStaffAccount = async (req, res) => {
  try {
    const result = await authService.createStaffAccount(req.body, req.user);
    res.status(201).json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

const listStaffAccounts = async (req, res) => {
  try {
    const result = await authService.listStaffAccounts(req.query);
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

const searchFamilyAccounts = async (req, res) => {
  try {
    const result = await authService.searchFamilyAccounts(req.query);
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

const toggleStaffActive = async (req, res) => {
  try {
    const result = await authService.toggleStaffActive(req.params.id, req.user);
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

// update profile
const updateProfile = async (req, res) => {
  try {
    const result = await authService.updateProfile(req.user, req.body);
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

const requestEmailChangeOtp = async (req, res) => {
  try {
    const result = await authService.requestEmailChangeOtp(req.user, req.body);
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

const requestPhoneChangeOtp = async (req, res) => {
  try {
    const result = await authService.requestPhoneChangeOtp(req.user, req.body);
    res.json(result);
  } catch (err) {
    console.error('requestPhoneChangeOtp error', { body: req.body, userId: req.user && req.user._id, err });
    sendApiError(res, err);
  }
};

const verifyEmailChangeOtp = async (req, res) => {
  try {
    const result = await authService.verifyEmailChangeOtp(req.user, req.body);
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

const verifyPhoneChangeOtp = async (req, res) => {
  try {
    const result = await authService.verifyPhoneChangeOtp(req.user, req.body);
    res.json(result);
  } catch (err) {
    console.error('verifyPhoneChangeOtp error', { body: req.body, userId: req.user && req.user._id, err });
    sendApiError(res, err);
  }
};

// doi pass
const changePassword = async (req, res) => {
  try {
    const result = await authService.changePassword(req.user, req.body);
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

// forgot password
const forgotPassword = async (req, res) => {
  try {
    const result = await authService.forgotPassword(req.body);
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

// reset password
const resetPassword = async (req, res) => {
  try {
    const result = await authService.resetPassword(req.body);
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

// update user by admin
const updateUserByAdmin = async (req, res) => {
  try {
    const result = await authService.updateUserByAdmin(req.params.id, req.body, req.user);
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

const createFirebaseToken = async (req, res) => {
  try {
    const result = await authService.createFirebaseCustomToken(req.user);
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

module.exports = {
  login,
  getMe,
  createStaffAccount,
  listStaffAccounts,
  searchFamilyAccounts,
  toggleStaffActive,
  updateProfile,
  requestEmailChangeOtp,
  requestPhoneChangeOtp,
  verifyEmailChangeOtp,
  verifyPhoneChangeOtp,
  changePassword,
  forgotPassword,
  resetPassword,
  updateUserByAdmin,
  createFirebaseToken,
};
