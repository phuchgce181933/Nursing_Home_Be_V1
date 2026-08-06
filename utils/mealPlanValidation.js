const ServiceError = require('../services/serviceError');
const mealPlanEntryRepo = require('../repositories/mealPlanEntryRepository');
const { toMinutes } = require('./shiftTime');

const MEAL_TYPE_VI = {
  breakfast: 'bữa sáng',
  lunch: 'bữa trưa',
  dinner: 'bữa tối',
};

const residentKey = (residentId) => String(residentId?._id || residentId || '');

const normalizeEntry = (entry) => ({
  residentId: residentKey(entry.residentId),
  mealType: String(entry.mealType || '').trim(),
  mealTime: String(entry.mealTime || '').trim(),
  mealName: entry.mealName,
});

const pushConflict = (conflicts, conflict) => {
  const key = `${conflict.type}:${conflict.residentId}:${conflict.mealType || ''}:${conflict.mealTime || ''}`;
  if (conflicts.some((c) => `${c.type}:${c.residentId}:${c.mealType || ''}:${c.mealTime || ''}` === key)) {
    return;
  }
  conflicts.push(conflict);
};

const findInBatchMealConflicts = (entries = []) => {
  const conflicts = [];
  const normalized = entries.map(normalizeEntry);
  const typeSeen = new Map();
  const timeSeen = new Map();

  for (const entry of normalized) {
    if (!entry.residentId || !entry.mealType) continue;

    const typeKey = `${entry.residentId}:${entry.mealType}`;
    if (typeSeen.has(typeKey)) {
      pushConflict(conflicts, {
        type: 'DUPLICATE_MEAL_TYPE',
        severity: 'ERROR',
        residentId: entry.residentId,
        mealType: entry.mealType,
        message: `Cư dân đã có ${MEAL_TYPE_VI[entry.mealType] || entry.mealType} trong thực đơn này.`,
        details: { otherIndex: typeSeen.get(typeKey) },
      });
    } else {
      typeSeen.set(typeKey, entry);
    }

    if (entry.mealTime && toMinutes(entry.mealTime) !== null) {
      const timeKey = `${entry.residentId}:${entry.mealTime}`;
      if (timeSeen.has(timeKey)) {
        const other = timeSeen.get(timeKey);
        pushConflict(conflicts, {
          type: 'DUPLICATE_MEAL_TIME',
          severity: 'ERROR',
          residentId: entry.residentId,
          mealTime: entry.mealTime,
          message: `Cư dân không thể có hai bữa cùng giờ ${entry.mealTime} trong thực đơn này.`,
          details: {
            mealType: entry.mealType,
            otherMealType: other.mealType,
          },
        });
      } else {
        timeSeen.set(timeKey, entry);
      }
    }
  }

  return conflicts;
};

const findCrossPlanMealConflicts = async ({ workDate, entries = [], excludeMealPlanDayId }) => {
  const conflicts = [];
  const normalized = entries.map(normalizeEntry);
  const residentIds = [...new Set(normalized.map((e) => e.residentId).filter(Boolean))];
  if (!residentIds.length) return conflicts;

  const existingRows = await mealPlanEntryRepo.findByResidentsOnWorkDate(residentIds, workDate, {
    excludeMealPlanDayId,
  });

  for (const entry of normalized) {
    if (!entry.residentId) continue;

    for (const row of existingRows) {
      const existingResidentId = residentKey(row.residentId);
      if (existingResidentId !== entry.residentId) continue;

      const planLabel = row.planTitle || 'meal plan khác';
      const planStatus = row.planStatus === 'published' ? 'đã đăng' : 'nháp';

      if (entry.mealType && row.mealType === entry.mealType) {
        pushConflict(conflicts, {
          type: 'DUPLICATE_MEAL_TYPE',
          severity: 'ERROR',
          residentId: entry.residentId,
          mealType: entry.mealType,
          message: `Cư dân đã có ${MEAL_TYPE_VI[entry.mealType] || entry.mealType} trong ngày này (${planLabel}, ${planStatus}).`,
          details: {
            existingEntryId: row._id,
            mealPlanDayId: row.mealPlanDayId,
            planTitle: row.planTitle,
            planStatus: row.planStatus,
          },
        });
      }

      const entryMinutes = toMinutes(entry.mealTime);
      const rowMinutes = toMinutes(row.mealTime);
      if (
        entry.mealTime &&
        row.mealTime &&
        entryMinutes !== null &&
        rowMinutes !== null &&
        entryMinutes === rowMinutes
      ) {
        pushConflict(conflicts, {
          type: 'DUPLICATE_MEAL_TIME',
          severity: 'ERROR',
          residentId: entry.residentId,
          mealTime: entry.mealTime,
          message: `Cư dân đã có bữa lúc ${entry.mealTime} trong ngày này (${planLabel}, ${planStatus}).`,
          details: {
            existingEntryId: row._id,
            mealType: entry.mealType,
            existingMealType: row.mealType,
            mealPlanDayId: row.mealPlanDayId,
            planTitle: row.planTitle,
            planStatus: row.planStatus,
          },
        });
      }
    }
  }

  return conflicts;
};

const hasBlockingMealConflicts = (conflicts = []) => conflicts.some((c) => c.severity === 'ERROR');

const formatMealConflictMessage = (conflicts) => {
  const errors = conflicts.filter((c) => c.severity === 'ERROR');
  if (!errors.length) return 'Meal plan có xung đột trùng bữa ăn.';
  return errors.map((c) => c.message).filter(Boolean).join(' ');
};

const assertNoMealPlanConflicts = async ({ workDate, entries, excludeMealPlanDayId }) => {
  const inBatch = findInBatchMealConflicts(entries);
  const crossPlan = await findCrossPlanMealConflicts({ workDate, entries, excludeMealPlanDayId });
  const conflicts = [...inBatch, ...crossPlan];

  if (!hasBlockingMealConflicts(conflicts)) return conflicts;

  const err = new ServiceError(formatMealConflictMessage(conflicts), 400);
  err.conflicts = conflicts;
  throw err;
};

module.exports = {
  MEAL_TYPE_VI,
  findInBatchMealConflicts,
  findCrossPlanMealConflicts,
  hasBlockingMealConflicts,
  assertNoMealPlanConflicts,
};
