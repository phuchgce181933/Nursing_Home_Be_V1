const Bed = require('../models/bed');
const Room = require('../models/room');
const Resident = require('../models/resident');

const PRESERVED_BED_STATUSES = new Set(['maintenance', 'reserved']);

/**
 * Reconcile room.occupiedCount and bed status/assignedResidentId from admitted residents.
 * @param {import('mongoose').Types.ObjectId|string} roomId
 * @param {{ fix?: boolean }} [options]
 */
const syncRoomOccupancy = async (roomId, { fix = true } = {}) => {
  const room = await Room.findById(roomId);
  if (!room) return null;

  const beds = await Bed.find({ roomId });
  const admittedResidents = await Resident.find({
    bedId: { $in: beds.map((b) => b._id) },
    residencyStatus: 'admitted',
  }).select('_id bedId fullName residentCode');

  const residentByBedId = new Map(
    admittedResidents.map((r) => [String(r.bedId), r])
  );

  let occupiedCount = 0;
  const bedUpdates = [];

  for (const bed of beds) {
    const residentOnBed = residentByBedId.get(String(bed._id));
    const hasAssignment = Boolean(bed.assignedResidentId || residentOnBed);
    const preserveStatus = PRESERVED_BED_STATUSES.has(bed.status);

    if (hasAssignment && !preserveStatus) {
      occupiedCount += 1;
      const resolvedResidentId = bed.assignedResidentId || residentOnBed._id;
      if (
        bed.status !== 'occupied' ||
        String(bed.assignedResidentId || '') !== String(resolvedResidentId)
      ) {
        if (fix) {
          bed.status = 'occupied';
          bed.assignedResidentId = resolvedResidentId;
          await bed.save();
        }
        bedUpdates.push({ bedId: bed._id, bedCode: bed.bedCode, action: 'mark_occupied' });
      }
    } else if (!hasAssignment && !preserveStatus) {
      if (bed.status !== 'available' || bed.assignedResidentId) {
        if (fix) {
          bed.status = 'available';
          bed.assignedResidentId = null;
          await bed.save();
        }
        bedUpdates.push({ bedId: bed._id, bedCode: bed.bedCode, action: 'mark_available' });
      }
    } else if (hasAssignment) {
      occupiedCount += 1;
    }
  }

  const before = { occupiedCount: room.occupiedCount, status: room.status };
  if (fix) {
    room.occupiedCount = occupiedCount;
    if (room.status !== 'closed' && room.status !== 'maintenance') {
      room.status = occupiedCount >= room.capacity ? 'full' : 'available';
    }
    await room.save();
  }

  return {
    roomId: room._id,
    roomNumber: room.roomNumber,
    before,
    after: fix ? { occupiedCount: room.occupiedCount, status: room.status } : { occupiedCount, status: room.status },
    actualOccupied: occupiedCount,
    capacity: room.capacity,
    bedUpdates,
  };
};

const diagnoseTransferData = async () => {
  const issues = [];

  const admittedWithBed = await Resident.find({
    residencyStatus: 'admitted',
    bedId: { $ne: null },
  })
    .select('fullName residentCode bedId roomId')
    .lean();

  for (const resident of admittedWithBed) {
    const bed = await Bed.findById(resident.bedId).lean();
    if (!bed) {
      issues.push({
        type: 'RESIDENT_BED_MISSING',
        residentId: resident._id,
        fullName: resident.fullName,
        residentCode: resident.residentCode,
        bedId: resident.bedId,
      });
      continue;
    }

    if (String(bed.roomId) !== String(resident.roomId)) {
      issues.push({
        type: 'RESIDENT_ROOM_BED_MISMATCH',
        residentId: resident._id,
        fullName: resident.fullName,
        residentCode: resident.residentCode,
        residentRoomId: resident.roomId,
        bedRoomId: bed.roomId,
        bedCode: bed.bedCode,
      });
    }

    if (bed.status === 'available' && !bed.assignedResidentId) {
      issues.push({
        type: 'GHOST_AVAILABLE_BED',
        residentId: resident._id,
        fullName: resident.fullName,
        residentCode: resident.residentCode,
        bedId: bed._id,
        bedCode: bed.bedCode,
        detail: 'Resident assigned but bed shows available with no assignedResidentId',
      });
    }

    if (bed.assignedResidentId && String(bed.assignedResidentId) !== String(resident._id)) {
      issues.push({
        type: 'BED_ASSIGNED_TO_OTHER',
        residentId: resident._id,
        fullName: resident.fullName,
        bedId: bed._id,
        bedCode: bed.bedCode,
        assignedResidentId: bed.assignedResidentId,
      });
    }
  }

  const rooms = await Room.find({ status: { $ne: 'closed' } }).lean();
  for (const room of rooms) {
    const occupiedBeds = await Bed.countDocuments({
      roomId: room._id,
      $or: [{ status: 'occupied' }, { assignedResidentId: { $ne: null } }],
    });
    const availableBeds = await Bed.find({
      roomId: room._id,
      status: 'available',
      assignedResidentId: null,
    }).select('bedCode status').lean();

    if (room.occupiedCount !== occupiedBeds) {
      issues.push({
        type: 'ROOM_OCCUPIED_COUNT_DRIFT',
        roomId: room._id,
        roomNumber: room.roomNumber,
        storedOccupiedCount: room.occupiedCount,
        actualOccupiedBeds: occupiedBeds,
        capacity: room.capacity,
      });
    }

    if (room.occupiedCount >= room.capacity && availableBeds.length > 0) {
      issues.push({
        type: 'ROOM_FULL_BUT_AVAILABLE_BEDS',
        roomId: room._id,
        roomNumber: room.roomNumber,
        occupiedCount: room.occupiedCount,
        capacity: room.capacity,
        availableBedCodes: availableBeds.map((b) => b.bedCode),
        detail: 'POST transfer fails with ROOM_FULL while GET still lists these beds',
      });
    }
  }

  const orphanOccupiedBeds = await Bed.find({
    status: 'occupied',
    assignedResidentId: null,
  }).select('bedCode roomId status').lean();

  for (const bed of orphanOccupiedBeds) {
    const resident = await Resident.findOne({ bedId: bed._id, residencyStatus: 'admitted' }).lean();
    if (!resident) {
      issues.push({
        type: 'ORPHAN_OCCUPIED_BED',
        bedId: bed._id,
        bedCode: bed.bedCode,
        roomId: bed.roomId,
      });
    }
  }

  return issues;
};

const syncAllRoomOccupancy = async ({ fix = true } = {}) => {
  const rooms = await Room.find({ status: { $ne: 'closed' } }).select('_id').lean();
  const results = [];
  for (const room of rooms) {
    results.push(await syncRoomOccupancy(room._id, { fix }));
  }
  return results.filter(Boolean);
};

module.exports = {
  syncRoomOccupancy,
  syncAllRoomOccupancy,
  diagnoseTransferData,
};
