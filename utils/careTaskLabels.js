const { CARE_TASK_TYPES, CARE_LEVELS } = require('../models/enums');

const CARE_TASK_TYPE_LABELS_VI = {
  morning_care: 'Chăm sóc buổi sáng',
  medication: 'Cho thuốc',
  physical_therapy: 'Vật lý trị liệu',
  meal_assistance: 'Hỗ trợ bữa ăn',
  evening_check: 'Kiểm tra buổi tối',
  emergency_response: 'Ứng phó khẩn cấp',
};

const CARE_LEVEL_LABELS_VI = {
  low: 'Thấp',
  medium: 'Trung bình',
  high: 'Cao',
};

const CARE_TASK_STATUS_LABELS_VI = {
  pending: 'Chờ',
  in_progress: 'Đang làm',
  completed: 'Hoàn thành',
  skipped: 'Bỏ qua',
  missed: 'Bỏ lỡ',
};

const getTaskTypeOptions = () =>
  CARE_TASK_TYPES.map((value) => ({
    value,
    labelVi: CARE_TASK_TYPE_LABELS_VI[value] || value,
  }));

const getCareLevelOptions = () =>
  CARE_LEVELS.map((value) => ({
    value,
    labelVi: CARE_LEVEL_LABELS_VI[value] || value,
  }));

const getCareTaskStatusLabel = (status) =>
  CARE_TASK_STATUS_LABELS_VI[status] || status;

module.exports = {
  CARE_TASK_TYPE_LABELS_VI,
  CARE_LEVEL_LABELS_VI,
  CARE_TASK_STATUS_LABELS_VI,
  getTaskTypeOptions,
  getCareLevelOptions,
  getCareTaskStatusLabel,
};
