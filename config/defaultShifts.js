/** Fixed system shift slots — single source of truth for bootstrap and validation. */
const DEFAULT_SHIFTS = [
  {
    shiftCode: 'DAWN',
    name: 'Ca Đêm/Sáng sớm',
    shiftType: 'night',
    startTime: '00:00',
    endTime: '08:00',
    colorLabel: '#3F51B5',
    description: 'Ca 1 — Đêm/Sáng sớm (00:00 – 08:00)',
  },
  {
    shiftCode: 'DAY',
    name: 'Ca Ngày/Hành chính',
    shiftType: 'morning',
    startTime: '08:00',
    endTime: '16:00',
    colorLabel: '#4CAF50',
    description: 'Ca 2 — Ngày/Hành chính (08:00 – 16:00)',
  },
  {
    shiftCode: 'EVENING',
    name: 'Ca Chiều/Tối',
    shiftType: 'afternoon',
    startTime: '16:00',
    endTime: '00:00',
    colorLabel: '#FF9800',
    description: 'Ca 3 — Chiều/Tối (16:00 – 24:00)',
  },
  {
    shiftCode: 'SPLIT',
    name: 'Ca gãy',
    shiftType: 'custom',
    startTime: '00:00',
    endTime: '23:59',
    colorLabel: '#9C27B0',
    description: 'Ca đột xuất — nhập giờ bắt đầu/kết thúc khi phân công',
    isFlexibleTime: true,
  },
];

const SYSTEM_SHIFT_CODES = DEFAULT_SHIFTS.map((s) => s.shiftCode);

module.exports = { DEFAULT_SHIFTS, SYSTEM_SHIFT_CODES };
