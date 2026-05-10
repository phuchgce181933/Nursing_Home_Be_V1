const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/user');
const StaffProfile = require('../models/staffProfile');

const STAFF_ROLES = ['doctor', 'nurse', 'manager', 'staff'];
const STAFF_CODE_PREFIXES = { doctor: 'DOC', nurse: 'NUR', manager: 'MGR', staff: 'STF', admin: 'ADM' };

// Auto-generate unique staffCode: PREFIX + last 6 digits of timestamp
const generateStaffCode = (role) => {
  const prefix = STAFF_CODE_PREFIXES[role] || 'STF';
  return `${prefix}${Date.now().toString().slice(-6)}`;
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });
    if (!user.isActive) return res.status(401).json({ message: 'Account is inactive' });
    if (user.isBanned) return res.status(401).json({ message: 'Account is banned', reason: user.banReason });

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) return res.status(401).json({ message: 'Invalid credentials' });

    user.lastLoginAt = new Date();
    await user.save();

    const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.json({
      token,
      user: {
        _id: user._id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        avatarUrl: user.avatarUrl,
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getMe = async (req, res) => {
  try {
    const userData = {
      _id: req.user._id,
      fullName: req.user.fullName,
      email: req.user.email,
      phone: req.user.phone,
      role: req.user.role,
      gender: req.user.gender,
      dateOfBirth: req.user.dateOfBirth,
      avatarUrl: req.user.avatarUrl,
      address: req.user.address,
      isActive: req.user.isActive,
      lastLoginAt: req.user.lastLoginAt,
      createdAt: req.user.createdAt,
    };

    // Attach staffProfile for staff roles
    if (['admin', 'manager', 'doctor', 'nurse', 'staff'].includes(req.user.role)) {
      const staffProfile = await StaffProfile.findOne({ userId: req.user._id });
      userData.staffProfile = staffProfile || null;
    }

    res.json(userData);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/auth/create-staff — admin or manager creates account for doctor/nurse/staff
const createStaffAccount = async (req, res) => {
  try {
    const {
      fullName,
      email,
      password,
      role,
      phone,
      gender,
      dateOfBirth,
      address,
      specialty,
      staffCode,
      certifications,
    } = req.body;

    if (!fullName || !email || !password || !role) {
      return res.status(400).json({ message: 'fullName, email, password and role are required' });
    }

    if (!STAFF_ROLES.includes(role)) {
      return res.status(400).json({ message: `role must be one of: ${STAFF_ROLES.join(', ')}` });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'password must be at least 6 characters' });
    }

    const existing = await User.findOne({ email: email.toLowerCase().trim() });
    if (existing) {
      return res.status(409).json({ message: 'Email already in use' });
    }

    const resolvedStaffCode = staffCode ? staffCode.toUpperCase().trim() : generateStaffCode(role);

    const codeConflict = await StaffProfile.findOne({ staffCode: resolvedStaffCode });
    if (codeConflict) {
      return res.status(409).json({ message: `staffCode "${resolvedStaffCode}" already exists` });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await User.create({
      fullName: fullName.trim(),
      email: email.toLowerCase().trim(),
      passwordHash,
      role,
      phone: phone?.trim(),
      gender: gender || 'unknown',
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
      address: address?.trim(),
      isActive: true,
    });

    const staffProfile = await StaffProfile.create({
      userId: user._id,
      staffCode: resolvedStaffCode,
      roleCategory: role,
      specialty: specialty?.trim(),
      certifications: certifications || [],
    });

    res.status(201).json({
      message: 'Staff account created successfully',
      user: {
        _id: user._id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        createdAt: user.createdAt,
      },
      staffProfile: {
        _id: staffProfile._id,
        staffCode: staffProfile.staffCode,
        roleCategory: staffProfile.roleCategory,
        specialty: staffProfile.specialty,
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/auth/staff — admin or manager lists all staff accounts
const listStaffAccounts = async (req, res) => {
  try {
    const { role, isActive, search, page = 1, limit = 20 } = req.query;

    const filter = { role: { $in: [...STAFF_ROLES, 'admin'] } };
    if (role) {
      if (![...STAFF_ROLES, 'admin'].includes(role)) {
        return res.status(400).json({ message: `role must be one of: ${[...STAFF_ROLES, 'admin'].join(', ')}` });
      }
      filter.role = role;
    }
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    if (search) {
      filter.$or = [
        { fullName: { $regex: search.trim(), $options: 'i' } },
        { email: { $regex: search.trim(), $options: 'i' } },
      ];
    }

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const [users, total] = await Promise.all([
      User.find(filter)
        .select('-passwordHash -resetPasswordTokenHash')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      User.countDocuments(filter),
    ]);

    const userIds = users.map((u) => u._id);
    const staffProfiles = await StaffProfile.find({ userId: { $in: userIds } });
    const profileMap = Object.fromEntries(staffProfiles.map((p) => [p.userId.toString(), p]));

    const data = users.map((u) => ({
      ...u.toObject(),
      staffProfile: profileMap[u._id.toString()] || null,
    }));

    res.json({ data, total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// PUT /api/auth/staff/:id/toggle-active — admin or manager activates/deactivates a staff account
const toggleStaffActive = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-passwordHash -resetPasswordTokenHash');
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (!['admin', ...STAFF_ROLES].includes(user.role)) {
      return res.status(400).json({ message: 'Can only toggle staff accounts' });
    }

    // Prevent self-deactivation
    if (user._id.toString() === req.user._id.toString()) {
      return res.status(400).json({ message: 'Cannot change your own active status' });
    }

    user.isActive = !user.isActive;
    await user.save();

    res.json({
      message: `Account ${user.isActive ? 'activated' : 'deactivated'} successfully`,
      user: { _id: user._id, fullName: user.fullName, email: user.email, role: user.role, isActive: user.isActive },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { login, getMe, createStaffAccount, listStaffAccounts, toggleStaffActive };
