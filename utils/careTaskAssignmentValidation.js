const careAppointmentRepo = require('../repositories/careAppointmentRepository');
const careTaskRepo = require('../repositories/careTaskRepository');
const { apiErr, CODES } = require('./apiError');
const { toMinutes, formatTimeVN } = require('./shiftTime');

const MIN_STAFF_DUTY_GAP_MINUTES = 5;
const BLOCKING_TASK_STATUSES = ['pending', 'in_progress'];
const CLINICAL_APPOINTMENT_ROLES = ['doctor', 'nurse'];

const idOf = (value) => String(value?._id || value || '');

const findGapConflict = (scheduledTime, tasks, excludeTaskId) => {
  const newMinutes = toMinutes(scheduledTime);
  if (newMinutes === null) return null;

  for (const task of tasks || []) {
    if (excludeTaskId && idOf(task._id) === idOf(excludeTaskId)) continue;
    if (!BLOCKING_TASK_STATUSES.includes(task.status)) continue;
    const existingMinutes = toMinutes(task.scheduledTime);
    if (existingMinutes === null) continue;
    if (Math.abs(newMinutes - existingMinutes) < MIN_STAFF_DUTY_GAP_MINUTES) {
      return task.scheduledTime;
    }
  }
  return null;
};

const assertNoClinicalAppointmentAtTime = async (
  staffProfileId,
  assigneeRole,
  effectiveAt,
  errorCode = CODES.CARE_TASK_APPOINTMENT_BLOCKS
) => {
  const role = String(assigneeRole || '').trim().toLowerCase();
  if (!CLINICAL_APPOINTMENT_ROLES.includes(role)) return;

  const conflict = await careAppointmentRepo.findOneStaffConflictAtTime(staffProfileId, effectiveAt);

  if (!conflict) return;

  throw apiErr(errorCode, {
    statusCode: 400,
    params: {
      time: formatTimeVN(effectiveAt),
      from: formatTimeVN(conflict.scheduledStartAt),
      to: formatTimeVN(conflict.scheduledEndAt),
    },
  });
};

const assertStaffDutyMinGap = async (staffProfileId, workDate, scheduledTime, options = {}) => {
  const {
    excludeTaskId,
    extraTasks = [],
    errorCode = CODES.CARE_TASK_TIME_TOO_CLOSE,
  } = options;

  const tasks = await careTaskRepo.findByStaffAndDate(staffProfileId, workDate);
  const conflictTime = findGapConflict(scheduledTime, [...tasks, ...extraTasks], excludeTaskId);
  if (!conflictTime) return;

  throw apiErr(errorCode, {
    statusCode: 400,
    params: {
      scheduledTime,
      conflictTime,
      minGapMinutes: MIN_STAFF_DUTY_GAP_MINUTES,
    },
  });
};

const assertBatchStaffDutyMinGap = (
  validatedEntries,
  errorCode = CODES.CARE_SCHEDULE_ENTRY_TIME_TOO_CLOSE
) => {
  const byStaff = new Map();

  for (const row of validatedEntries) {
    const entry = row.entry;
    const staffId = idOf(entry.staffProfileId);
    if (!byStaff.has(staffId)) byStaff.set(staffId, []);
    byStaff.get(staffId).push({ scheduledTime: entry.scheduledTime, status: 'pending' });
  }

  for (const pseudoTasks of byStaff.values()) {
    for (let i = 0; i < pseudoTasks.length; i += 1) {
      for (let j = i + 1; j < pseudoTasks.length; j += 1) {
        const a = toMinutes(pseudoTasks[i].scheduledTime);
        const b = toMinutes(pseudoTasks[j].scheduledTime);
        if (a === null || b === null) continue;
        if (Math.abs(a - b) < MIN_STAFF_DUTY_GAP_MINUTES) {
          throw apiErr(errorCode, {
            statusCode: 400,
            params: {
              scheduledTime: pseudoTasks[i].scheduledTime,
              conflictTime: pseudoTasks[j].scheduledTime,
              minGapMinutes: MIN_STAFF_DUTY_GAP_MINUTES,
            },
          });
        }
      }
    }
  }
};

module.exports = {
  MIN_STAFF_DUTY_GAP_MINUTES,
  BLOCKING_TASK_STATUSES,
  findGapConflict,
  assertNoClinicalAppointmentAtTime,
  assertStaffDutyMinGap,
  assertBatchStaffDutyMinGap,
};
