const shiftTemplateRepo = require('../repositories/shiftTemplateRepository');
const shiftRepo = require('../repositories/shiftRepository');

const parseTime = (t) => {
  const [h, m] = t.split(':').map(Number);
  if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) throw new Error(`Invalid time format: ${t}`);
  return h * 60 + m;
};

const calcDuration = (start, end) => {
  const s = parseTime(start);
  const e = parseTime(end);
  return e > s ? (e - s) / 60 : (1440 - s + e) / 60;
};

const validateTemplateInput = async (body, existingId = null) => {
  const { name, shiftCode, shiftType, startTime, endTime, department } = body;
  const errors = [];
  if (!name || !name.trim()) errors.push('name is required');
  if (!shiftCode || !shiftCode.trim()) errors.push('shiftCode is required');
  if (!shiftType) errors.push('shiftType is required');
  if (!startTime) errors.push('startTime is required');
  if (!endTime) errors.push('endTime is required');

  if (startTime && endTime) {
    try {
      const duration = calcDuration(startTime, endTime);
      if (duration < 4 || duration > 12)
        errors.push(`Duration must be between 4 and 12 hours (calculated: ${duration.toFixed(2)}h)`);
    } catch (e) {
      errors.push(e.message);
    }
  }

  if (shiftCode) {
    const existing = await shiftTemplateRepo.findByShiftCode(shiftCode);
    if (existing && String(existing._id) !== String(existingId))
      errors.push(`shiftCode '${shiftCode.toUpperCase()}' is already in use`);
  }

  if (name) {
    const existing = await shiftTemplateRepo.findByNameAndDepartment(name.trim(), department || null);
    if (existing && String(existing._id) !== String(existingId))
      errors.push(`A template named '${name}' already exists for this department`);
  }

  return errors;
};

const createTemplate = async (body, actorUserId) => {
  const errors = await validateTemplateInput(body);
  if (errors.length) throw Object.assign(new Error(errors.join('; ')), { status: 400 });

  const doc = await shiftTemplateRepo.create({
    name: body.name.trim(),
    shiftCode: body.shiftCode.trim().toUpperCase(),
    shiftType: body.shiftType,
    startTime: body.startTime,
    endTime: body.endTime,
    department: body.department || null,
    colorLabel: body.colorLabel,
    minStaff: body.minStaff,
    description: body.description,
    createdBy: actorUserId,
    status: 'active',
  });
  return doc;
};

const updateTemplate = async (id, body, actorUserId) => {
  const template = await shiftTemplateRepo.findById(id);
  if (!template) throw Object.assign(new Error('Shift template not found'), { status: 404 });
  if (template.status === 'archived')
    throw Object.assign(new Error('Cannot update an archived template'), { status: 400 });

  // Only override fields that are explicitly provided in body (skip undefined values)
  const definedBody = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));

  const errors = await validateTemplateInput(
    { ...template.toObject(), ...definedBody },
    id
  );
  if (errors.length) throw Object.assign(new Error(errors.join('; ')), { status: 400 });

  const futureShifts = await shiftRepo.findFutureShiftsByTemplate(id);
  const warning = futureShifts.length
    ? `This template has ${futureShifts.length} future scheduled shift(s). They will keep their original times; only new assignments will use the updated template.`
    : null;

  const updatePayload = { ...definedBody };
  if (definedBody.shiftCode) updatePayload.shiftCode = definedBody.shiftCode.toUpperCase();

  const updated = await shiftTemplateRepo.updateById(id, updatePayload);
  return { template: updated, warning };
};

const listTemplates = async (filter = {}) => {
  const query = {};
  if (filter.status) query.status = filter.status;
  if (filter.shiftType) query.shiftType = filter.shiftType;
  if (filter.department) query.department = filter.department;
  return shiftTemplateRepo.findAll(query);
};

const getTemplate = async (id) => {
  const t = await shiftTemplateRepo.findById(id);
  if (!t) throw Object.assign(new Error('Shift template not found'), { status: 404 });
  return t;
};

const updateTemplateStatus = async (id, status) => {
  const allowed = ['active', 'inactive'];
  if (!allowed.includes(status))
    throw Object.assign(new Error(`status must be one of: ${allowed.join(', ')}`), { status: 400 });

  const template = await shiftTemplateRepo.findById(id);
  if (!template) throw Object.assign(new Error('Shift template not found'), { status: 404 });
  if (template.status === 'archived')
    throw Object.assign(new Error('Cannot change status of an archived template'), { status: 400 });

  return shiftTemplateRepo.updateById(id, { status });
};

const deleteTemplate = async (id) => {
  const template = await shiftTemplateRepo.findById(id);
  if (!template) throw Object.assign(new Error('Shift template not found'), { status: 404 });

  const futureShifts = await shiftRepo.findFutureShiftsByTemplate(id);
  if (futureShifts.length)
    throw Object.assign(
      new Error(
        `Cannot delete: ${futureShifts.length} future shift(s) use this template. Cancel those shifts or set the template to inactive first.`
      ),
      { status: 409 }
    );

  await shiftTemplateRepo.deleteById(id);
  return { deleted: true };
};

module.exports = { createTemplate, updateTemplate, listTemplates, getTemplate, updateTemplateStatus, deleteTemplate };
