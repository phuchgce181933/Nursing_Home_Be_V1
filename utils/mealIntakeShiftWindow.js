const shiftRepo = require('../repositories/shiftRepository');
const { apiErr } = require('./apiError');
const {
  getShiftStartDateTime,
  getShiftEndDateTime,
  UNCONFIRMED_AUTO_CANCEL_GRACE_MS,
  nowVN,
} = require('./shiftTime');
const workDateToDate = (workDateStr) => new Date(`${workDateStr}T00:00:00.000Z`);

const isWithinRecordingWindow = (workDateStr, shift, now = nowVN()) => {
  const start = getShiftStartDateTime(workDateStr, shift.startTime);
  const end = getShiftEndDateTime(workDateStr, shift.startTime, shift.endTime);
  const deadline = new Date(end.getTime() + UNCONFIRMED_AUTO_CANCEL_GRACE_MS);
  return now >= start && now <= deadline;
};

const getCaregiverRecordingWindow = async (staffProfileId, workDateStr, now = nowVN()) => {
  const shifts = await shiftRepo.findActiveShiftsForStaffOnDate(
    staffProfileId,
    workDateToDate(workDateStr)
  );
  const canMutate = shifts.some((s) => isWithinRecordingWindow(workDateStr, s, now));
  return { canMutate, shifts };
};

const assertCaregiverRecordingWindowOpen = async (profileId, workDateStr, errorCode) => {
  const { canMutate } = await getCaregiverRecordingWindow(profileId, workDateStr);
  if (!canMutate) {
    throw apiErr(errorCode, { statusCode: 403 });
  }
};

module.exports = {
  workDateToDate,
  isWithinRecordingWindow,
  getCaregiverRecordingWindow,
  assertCaregiverRecordingWindowOpen,
};
