const calculateDurationMinutes = (startAt, endAt) => {
  const start = new Date(startAt);
  const end = new Date(endAt);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }

  const diffMs = end.getTime() - start.getTime();
  if (diffMs <= 0) {
    return 0;
  }

  return Math.round(diffMs / (1000 * 60));
};

const formatDurationLabel = (durationMinutes) => {
  const totalMinutes = Number(durationMinutes);
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) {
    return '0 phút';
  }

  const totalDays = Math.floor(totalMinutes / (24 * 60));
  const remainingMinutes = totalMinutes % (24 * 60);
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;

  const parts = [];
  if (totalDays > 0) {
    parts.push(`${totalDays} ngày`);
  }

  if (hours > 0) {
    parts.push(`${hours}h`);
  }

  if (minutes > 0) {
    parts.push(`${minutes}p`);
  }

  if (parts.length === 0) {
    return '0 phút';
  }

  return parts.join(' ');
};

module.exports = {
  calculateDurationMinutes,
  formatDurationLabel,
};
