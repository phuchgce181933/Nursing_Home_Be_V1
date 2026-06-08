const ShiftTemplate = require('../models/shiftTemplate');
const { DEFAULT_SHIFTS, SYSTEM_SHIFT_CODES } = require('../config/defaultShifts');
const { calcShiftDurationHours } = require('../utils/shiftValidation');

const ensureDefaultShiftTemplates = async () => {
  for (const def of DEFAULT_SHIFTS) {
    const totalHours = Math.round(calcShiftDurationHours(def.startTime, def.endTime) * 100) / 100;
    const crossesMidnight = def.endTime <= def.startTime;
    await ShiftTemplate.findOneAndUpdate(
      { shiftCode: def.shiftCode },
      {
        $set: {
          name: def.name,
          shiftType: def.shiftType,
          startTime: def.startTime,
          endTime: def.endTime,
          totalHours,
          crossesMidnight,
          colorLabel: def.colorLabel,
          description: def.description,
          isSystem: true,
          status: 'active',
        },
        $unset: { minStaff: '', durationHours: '' },
        $setOnInsert: { shiftCode: def.shiftCode },
      },
      { upsert: true, runValidators: true }
    );
  }

  const archiveResult = await ShiftTemplate.updateMany(
    { shiftCode: { $nin: SYSTEM_SHIFT_CODES } },
    { $set: { status: 'archived' } }
  );

  console.log(
    `Default shift templates ensured (${DEFAULT_SHIFTS.length}). Archived ${archiveResult.modifiedCount} custom template(s).`
  );

  return { ensured: DEFAULT_SHIFTS.length, archivedCustom: archiveResult.modifiedCount };
};

module.exports = { ensureDefaultShiftTemplates };
