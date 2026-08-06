const shiftTemplateRepo = require('../repositories/shiftTemplateRepository');
const { calcShiftDurationHours } = require('../utils/shiftValidation');
const { apiErr, CODES } = require('../utils/apiError');

const formatTemplate = (doc) => {
  const t = doc.toObject ? doc.toObject() : doc;
  const totalHours =
    t.totalHours ??
    Math.round(calcShiftDurationHours(t.startTime, t.endTime) * 100) / 100;
  const { minStaff, durationHours, ...rest } = t;
  return { ...rest, totalHours };
};

const listTemplates = async (filter = {}) => {
  const query = { isSystem: true, status: 'active' };
  if (filter.shiftType) query.shiftType = filter.shiftType;
  const templates = await shiftTemplateRepo.findAll(query);
  const data = templates.map(formatTemplate);
  const totalHoursPerDay = Math.round(
    data.filter((t) => !t.isFlexibleTime).reduce((sum, t) => sum + t.totalHours, 0) * 100
  ) / 100;
  return { data, totalHoursPerDay };
};

const getTemplate = async (id) => {
  const t = await shiftTemplateRepo.findById(id);
  if (!t || !t.isSystem) throw apiErr(CODES.SHIFT_TEMPLATE_NOT_FOUND, { statusCode: 404 });
  if (t.status !== 'active') throw apiErr(CODES.SHIFT_TEMPLATE_INACTIVE, { statusCode: 404 });
  return formatTemplate(t);
};

module.exports = { listTemplates, getTemplate };
