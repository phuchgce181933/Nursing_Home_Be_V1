const fs = require('fs');
const path = require('path');
const { CODES, ERROR_MESSAGES } = require('../constants/apiErrorCodes');
const { SUCCESS, SUCCESS_MESSAGES } = require('../constants/apiSuccessCodes');

const viPath = path.join(__dirname, '..', '..', 'Nursing_Home_Fe_V1', 'src', 'i18n', 'apiMessages.vi.js');
const enPath = path.join(__dirname, '..', '..', 'Nursing_Home_Fe_V1', 'src', 'i18n', 'apiMessages.en.js');

function loadExisting(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const errors = {};
  const success = {};
  const errMatch = content.match(/export const apiErrors\w+ = \{([\s\S]*?)\};/);
  const sucMatch = content.match(/export const apiSuccess\w+ = \{([\s\S]*?)\};/);
  for (const [block, target] of [
    [errMatch && errMatch[1], errors],
    [sucMatch && sucMatch[1], success],
  ]) {
    if (!block) continue;
    const re = /^\s*([A-Z_][A-Z0-9_]*):\s*'((?:\\'|[^'])*)',?\s*$/gm;
    let m;
    while ((m = re.exec(block)) !== null) {
      target[m[1]] = m[2].replace(/\\n/g, '\n').replace(/\\'/g, "'");
    }
  }
  return { errors, success };
}

const existingVi = loadExisting(viPath);
const existingEn = loadExisting(enPath);

const viOverrides = {
  AUTH_CREDENTIALS_REQUIRED: existingVi.errors.AUTH_EMAIL_PASSWORD_REQUIRED,
  AUTH_CREATE_STAFF_REQUIRED: 'Họ tên, email, mật khẩu và vai trò là bắt buộc',
  AUTH_OTP_METADATA_INVALID: existingVi.errors.AUTH_OTP_INVALID_METADATA,
  AUTH_EMAIL_OTP_REQUIRED: existingVi.errors.AUTH_EMAIL_CHANGE_REQUIRES_OTP,
  AUTH_PASSWORD_REQUIRED: existingVi.errors.AUTH_PASSWORD_FIELDS_REQUIRED,
  AUTH_NEW_PASSWORD_TOO_SHORT: 'Mật khẩu mới phải có ít nhất {{min}} ký tự',
  AUTH_CANNOT_SELF_BAN: existingVi.errors.AUTH_CANNOT_DEACTIVATE_SELF,
  STAFF_ROLE_INVALID: 'Vai trò phải thuộc một trong: {{allowed}}',
  STAFF_AVAILABILITY_ROLE_INVALID: existingVi.errors.STAFF_ROLE_DOCTOR_NURSE_ONLY,
  STAFF_PROFILE_NOT_FOUND: existingVi.errors.STAFF_PROFILE_NOT_FOUND || 'Không tìm thấy hồ sơ nhân viên',
  MEAL_WORK_DATE_INVALID: 'workDate phải đúng định dạng YYYY-MM-DD',
  MEAL_OBJECT_ID_INVALID: '{{label}} không hợp lệ',
  MEAL_USER_NOT_IDENTIFIED: 'Không xác định được người dùng',
  MEAL_CARE_STAGE_INVALID: existingVi.errors.CARE_STAGE_INVALID,
  MEAL_NO_RESIDENTS: 'Kế hoạch bữa ăn phải có ít nhất một cư dân',
  MEAL_RESIDENTS_NOT_FOUND: existingVi.errors.RESIDENT_IDS_INVALID || 'Một số cư dân trong danh sách không tồn tại',
  MEAL_PLAN_NOT_FOUND: existingVi.errors.DRAFT_NOT_FOUND,
  MEAL_PLAN_DRAFT_ONLY_EDIT: existingVi.errors.DRAFT_ONLY_EDIT,
  MEAL_PLAN_DRAFT_ONLY_DELETE: existingVi.errors.DRAFT_ONLY_DELETE,
  MEAL_PLAN_PUBLISH_STATUS_INVALID: existingVi.errors.PUBLISH_STATUS_INVALID,
  MEAL_PLAN_PUBLISH_PAST_DATE: existingVi.errors.PUBLISH_PAST_DATE,
  MEAL_PLAN_PUBLISH_EMPTY: existingVi.errors.DRAFT_EMPTY,
  MEAL_PLAN_PUBLISH_NO_RESIDENTS: existingVi.errors.DRAFT_NO_RESIDENTS,
  MEAL_TIME_SCHEDULE_NOT_FOUND: 'Không tìm thấy lịch giờ ăn',
  MEAL_TIME_SCHEDULE_PUBLISHED_ONLY: 'Kế hoạch bữa ăn chỉ có thể liên kết với lịch giờ ăn đã đăng',
  MEAL_TIME_SCHEDULE_WORK_DATE_MISMATCH: 'workDate của kế hoạch bữa ăn phải trùng với ngày của lịch đã chọn',
  MEAL_TIME_SCHEDULE_IN_USE: 'Không thể xóa lịch giờ ăn đang được kế hoạch bữa ăn sử dụng',
  MEAL_ENTRY_TIME_INVALID: 'entries[{{index}}].mealTime phải đúng định dạng HH:mm',
  MEAL_ENTRY_TYPE_INVALID: 'entries[{{index}}].mealType phải thuộc một trong: {{allowed}}',
  MEAL_ENTRY_NAME_REQUIRED: 'entries[{{index}}].mealName là bắt buộc',
  MEAL_ENTRY_SOURCE_INVALID: 'entries[{{index}}].source phải thuộc một trong: {{allowed}}',
  MEAL_SPECIAL_DIET_NOT_FOUND: 'Không tìm thấy kế hoạch chế độ ăn đặc biệt',
  MEAL_SPECIAL_DIET_INELIGIBLE: 'Cư dân không đủ điều kiện cho kế hoạch chế độ ăn đặc biệt',
  MEAL_SPECIAL_DIET_DRAFT_ONLY_EDIT: 'Chỉ có thể cập nhật kế hoạch chế độ ăn ở trạng thái nháp',
  MEAL_SPECIAL_DIET_DRAFT_ONLY_DELETE: 'Chỉ có thể xóa kế hoạch chế độ ăn ở trạng thái nháp',
  MEAL_SPECIAL_DIET_PUBLISH_STATUS_INVALID: 'Không thể đăng kế hoạch chế độ ăn ở trạng thái {{status}}',
  MEAL_SPECIAL_DIET_PUBLISH_PAST_DATE: 'Không thể đăng kế hoạch chế độ ăn cho ngày trong quá khứ',
  MEAL_SPECIAL_DIET_PUBLISH_EMPTY: 'Không thể đăng kế hoạch chế độ ăn rỗng',
  MEAL_SPECIAL_DIET_PUBLISH_NO_RESIDENTS: 'Kế hoạch chế độ ăn phải có ít nhất một cư dân trước khi đăng',
  MEAL_ENTRY_DIET_TYPE_INVALID: 'entries[{{index}}].dietType phải thuộc một trong: {{allowed}}',
  MEAL_ENTRY_EFFECTIVE_TIME_INVALID: 'entries[{{index}}].effectiveTime phải đúng định dạng HH:mm',
  MEAL_TIME_SCHEDULE_DRAFT_ONLY_EDIT: 'Chỉ có thể cập nhật lịch giờ ăn ở trạng thái nháp',
  MEAL_TIME_SCHEDULE_DRAFT_ONLY_DELETE: 'Chỉ có thể xóa lịch giờ ăn ở trạng thái nháp',
  MEAL_TIME_SCHEDULE_PUBLISH_STATUS_INVALID: 'Không thể đăng lịch giờ ăn ở trạng thái {{status}}',
  MEAL_TIME_SCHEDULE_PUBLISH_EMPTY: 'Không thể đăng lịch giờ ăn rỗng',
  MEAL_TIME_SCHEDULE_PUBLISH_NO_RESIDENTS: 'Lịch giờ ăn phải có ít nhất một cư dân trước khi đăng',
  MEAL_TIME_SCHEDULE_NO_RESIDENTS: 'Lịch giờ ăn phải có ít nhất một cư dân',
  MEAL_TIME_SCHEDULE_RESIDENTS_MISMATCH: 'Một số cư dân trong kế hoạch bữa ăn không có trong lịch giờ ăn đã chọn',
  MEAL_RESIDENT_NO_MEAL_TIME_IN_SCHEDULE: 'Cư dân chưa có giờ {{mealType}} trong lịch giờ ăn đã chọn',
  MEAL_TIME_ENTRY_TIME_INVALID: 'entries[{{index}}].{{field}} phải đúng định dạng HH:mm',
  CARE_SCHEDULE_WORK_DATE_INVALID: 'workDate phải đúng định dạng YYYY-MM-DD',
  CARE_SCHEDULE_PAST_DATE: 'Không thể tạo lịch chăm sóc cho ngày trong quá khứ',
  CARE_SCHEDULE_ENTRIES_REQUIRED: 'entries là bắt buộc và không được để trống',
  CARE_SCHEDULE_ENTRIES_EMPTY: 'entries không được để trống',
  CARE_SCHEDULE_NO_RESIDENTS: 'Bản nháp lịch chăm sóc phải có ít nhất một cư dân',
  CARE_SCHEDULE_NOT_FOUND: 'Không tìm thấy lịch chăm sóc',
  CARE_SCHEDULE_DRAFT_ONLY_EDIT: 'Chỉ có thể cập nhật lịch chăm sóc ở trạng thái nháp',
  CARE_SCHEDULE_DRAFT_ONLY_DELETE: 'Chỉ có thể xóa lịch chăm sóc ở trạng thái nháp',
  CARE_SCHEDULE_PUBLISH_STATUS_INVALID: 'Không thể đăng lịch chăm sóc ở trạng thái {{status}}',
  CARE_SCHEDULE_PUBLISH_PAST_DATE: 'Không thể đăng lịch chăm sóc cho ngày trong quá khứ',
  CARE_SCHEDULE_PUBLISH_EMPTY: 'Không thể đăng lịch chăm sóc rỗng',
  CARE_SCHEDULE_ENTRY_RESIDENT_NOT_FOUND: 'Không tìm thấy cư dân: {{residentId}}',
  CARE_SCHEDULE_ENTRY_STAFF_NOT_FOUND: 'Không tìm thấy hồ sơ nhân viên: {{staffProfileId}}',
  CARE_SCHEDULE_ENTRY_SHIFT_NOT_FOUND: 'Không tìm thấy ca: {{shiftId}}',
  CARE_SCHEDULE_ENTRY_SHIFT_STATUS_INVALID: 'Ca phải ở trạng thái đã đăng hoặc đã xác nhận để đăng lịch chăm sóc',
  CARE_SCHEDULE_ENTRY_SHIFT_STAFF_MISMATCH: 'shiftId của dòng phải thuộc staffProfileId đã chọn',
  CARE_SCHEDULE_ENTRY_SHIFT_DATE_MISMATCH: 'workDate của ca phải trùng với workDate của lịch chăm sóc',
  CARE_SCHEDULE_ENTRY_TIME_INVALID: 'entries[{{index}}].scheduledTime phải đúng định dạng HH:mm',
  CARE_SCHEDULE_ENTRY_TIME_OUTSIDE_SHIFT: 'Thời gian {{scheduledTime}} phải nằm trong ca {{startTime}}-{{endTime}}',
  CARE_SCHEDULE_ENTRY_TIME_PAST: 'Thời gian lịch chăm sóc phải từ thời điểm hiện tại trở đi',
  CARE_SCHEDULE_ENTRY_SHIFT_ENDED: 'Không thể đăng dòng cho ca đã kết thúc',
  CARE_SCHEDULE_ENTRY_APPOINTMENT_BLOCKS: 'Nhân viên có lịch khám trong khung giờ này ({{from}}–{{to}})',
  CARE_SCHEDULE_ENTRY_TIME_TOO_CLOSE:
    'Hai nhiệm vụ của cùng nhân viên phải cách nhau ít nhất {{minGapMinutes}} phút (trùng với {{conflictTime}})',
  CARE_TASK_APPOINTMENT_BLOCKS: 'Nhân viên có lịch khám trong khung giờ này ({{from}}–{{to}})',
  CARE_TASK_TIME_TOO_CLOSE:
    'Hai nhiệm vụ của cùng nhân viên phải cách nhau ít nhất {{minGapMinutes}} phút (trùng với {{conflictTime}})',
  DISH_IN_USE: 'Không thể xóa hoặc tạm ngưng món đã được lên lịch trong kế hoạch bữa ăn',
  CARE_SCHEDULE_ENTRY_RESIDENT_OUTSIDE_AREA: 'Cư dân không thuộc khu vực phụ trách của nhân viên',
  CARE_SCHEDULE_ENTRY_SOURCE_INVALID: 'entries[{{index}}].source phải thuộc một trong: {{allowed}}',
  CARE_SCHEDULE_ENTRY_TASK_TYPE_INVALID: 'entries[{{index}}].taskType phải thuộc một trong: {{allowed}}',
  CARE_SCHEDULE_ENTRY_CARE_LEVEL_INVALID: 'entries[{{index}}].careLevel phải thuộc một trong: {{allowed}}',
  RESIDENT_ID_REQUIRED: 'residentId là bắt buộc',
  RESIDENT_ID_INVALID: '{{label}} không hợp lệ',
  RESIDENT_CONTACT_NOT_FOUND: existingVi.errors.RESIDENT_EMERGENCY_CONTACT_NOT_FOUND,
  RESIDENT_CODE_EXISTS: 'Mã cư dân đã tồn tại',
  RESIDENT_AGE_MINIMUM: 'Cư dân phải ít nhất {{minAge}} tuổi',
  RESIDENT_BODY_EMPTY: 'Nội dung yêu cầu trống hoặc không thể phân tích',
  RESIDENT_FULL_NAME_REQUIRED: 'Họ tên là bắt buộc',
  RESIDENT_EMERGENCY_CONTACT_PRIMARY_LIMIT: 'Chỉ được đánh dấu tối đa một liên hệ khẩn cấp là chính',
  RESIDENT_EMERGENCY_CONTACT_CANNOT_DELETE_PRIMARY: 'Không thể xóa liên hệ khẩn cấp chính mà chưa chỉ định liên hệ khác',
  RESIDENT_LOCATION_ID_REQUIRED: 'buildingId, floorId hoặc roomId là bắt buộc',
  RESIDENT_LOCATION_ID_INVALID: '{{label}} không hợp lệ',
  RESIDENT_HEALTH_CONDITION_REQUIRED: 'initialHealthCondition là bắt buộc',
  RESIDENT_HEALTH_CONDITION_TOO_SHORT: 'initialHealthCondition phải có ít nhất {{min}} ký tự',
  RESIDENT_BLOOD_TYPE_INVALID: 'bloodType phải thuộc một trong: {{allowed}}',
  RESIDENT_MEDICAL_HISTORY_REQUIRED: 'Cần cung cấp chronicConditions và/hoặc medicalHistory',
  RESIDENT_DRUG_ALLERGIES_REQUIRED: 'drugAllergies là bắt buộc (mảng, có thể rỗng)',
  RESIDENT_FILE_REQUIRED: 'Chưa tải lên tệp',
  RESIDENT_FILE_TYPE_UNSUPPORTED: 'Loại tệp không được hỗ trợ',
  RESIDENT_FILE_TOO_LARGE: 'Tệp quá lớn',
  RESIDENT_CLOUDINARY_NOT_CONFIGURED: 'Cloudinary chưa được cấu hình',
  RESIDENT_PERSONAL_INFO_NO_FIELDS: 'Không có trường thông tin cá nhân hợp lệ để cập nhật',
  RESIDENT_FAMILY_INFO_NO_FIELDS: 'Không có trường thông tin gia đình hợp lệ để cập nhật',
  SHIFT_COMPLETE_CONFIRMED_ONLY: 'Chỉ có thể hoàn thành ca ở trạng thái đã xác nhận (hiện tại: {{status}})',
  SHIFT_COMPLETE_NOT_ENDED: 'Ca làm việc chưa kết thúc',
  SHIFT_COMPLETE_WINDOW_CLOSED: 'Đã hết thời gian xác nhận hoàn thành ca (15 phút sau khi hết ca)',
  AUTH_ACCOUNT_ACTIVATED: 'Kích hoạt tài khoản thành công',
  AUTH_ACCOUNT_DEACTIVATED: 'Vô hiệu hóa tài khoản thành công',
  RESIDENT_HEALTH_SAVED: 'Đã lưu tình trạng sức khỏe ban đầu',
  RESIDENT_MEDICAL_HISTORY_SAVED: 'Đã lưu tiền sử bệnh',
  RESIDENT_ALLERGIES_SAVED: 'Đã lưu dị ứng thuốc',
  RESIDENT_AVATAR_UPDATED: 'Đã cập nhật ảnh đại diện cư dân',
  MEAL_PLAN_DRAFT_CREATED: existingVi.success.DRAFT_CREATED,
  MEAL_PLAN_DRAFT_UPDATED: existingVi.success.DRAFT_UPDATED,
  MEAL_PLAN_DRAFT_DELETED: existingVi.success.DRAFT_DELETED,
  MEAL_PLAN_PUBLISHED: existingVi.success.DRAFT_PUBLISHED,
  MEAL_TIME_SCHEDULE_DRAFT_CREATED: 'Tạo bản nháp lịch giờ ăn thành công',
  MEAL_TIME_SCHEDULE_DRAFT_UPDATED: 'Cập nhật bản nháp lịch giờ ăn thành công',
  MEAL_TIME_SCHEDULE_DRAFT_DELETED: 'Xóa bản nháp lịch giờ ăn thành công',
  MEAL_TIME_SCHEDULE_PUBLISHED: 'Đăng lịch giờ ăn thành công',
  MEAL_SPECIAL_DIET_DRAFT_CREATED: 'Tạo bản nháp chế độ ăn đặc biệt thành công',
  MEAL_SPECIAL_DIET_DRAFT_UPDATED: 'Cập nhật bản nháp chế độ ăn đặc biệt thành công',
  MEAL_SPECIAL_DIET_DRAFT_DELETED: 'Xóa bản nháp chế độ ăn đặc biệt thành công',
  MEAL_SPECIAL_DIET_PUBLISHED: 'Đăng chế độ ăn đặc biệt thành công',
  CARE_SCHEDULE_DRAFT_CREATED: 'Tạo bản nháp lịch chăm sóc thành công',
  CARE_SCHEDULE_DRAFT_UPDATED: 'Cập nhật bản nháp lịch chăm sóc thành công',
  CARE_SCHEDULE_DRAFT_DELETED: 'Xóa bản nháp lịch chăm sóc thành công',
  CARE_SCHEDULE_PUBLISHED: 'Đăng lịch chăm sóc thành công',
  SHIFT_CREATED: 'Tạo ca làm việc thành công',
  SHIFT_UPDATED: 'Cập nhật ca làm việc thành công',
  SHIFT_PUBLISHED: 'Đăng ca làm việc thành công',
  SHIFT_CONFIRMED: 'Xác nhận ca làm việc thành công',
  SHIFT_COMPLETED: 'Xác nhận hoàn thành ca thành công',
  SHIFT_CANCELLED: 'Hủy ca làm việc thành công',
  SHIFT_DELETED: 'Xóa ca làm việc thành công',
};

const legacyErrorAliases = [
  'AUTH_EMAIL_PASSWORD_REQUIRED',
  'AUTH_REQUIRED_FIELDS',
  'AUTH_OTP_INVALID_METADATA',
  'AUTH_EMAIL_CHANGE_REQUIRES_OTP',
  'AUTH_PASSWORD_FIELDS_REQUIRED',
  'AUTH_CANNOT_DEACTIVATE_SELF',
  'STAFF_ROLE_DOCTOR_NURSE_ONLY',
  'CAREGIVER_NO_ASSIGNED_RESIDENTS',
  'DRAFT_NOT_FOUND',
  'DRAFT_ONLY_EDIT',
  'DRAFT_ONLY_DELETE',
  'DRAFT_EMPTY',
  'DRAFT_NO_RESIDENTS',
  'DRAFT_ALREADY_PUBLISHED',
  'PUBLISH_PAST_DATE',
  'PUBLISH_STATUS_INVALID',
  'ENTRIES_REQUIRED',
  'ENTRIES_EMPTY',
  'MEAL_TIME_PAST_TODAY',
  'CARE_STAGE_INVALID',
  'RESIDENT_IDS_INVALID',
  'RESIDENT_EMERGENCY_CONTACT_NOT_FOUND',
  'RESIDENT_BED_OCCUPIED',
  'RESIDENT_TRANSFER_INVALID',
];

const legacySuccessAliases = [
  'AUTH_ACCOUNT_TOGGLED',
  'DRAFT_CREATED',
  'DRAFT_UPDATED',
  'DRAFT_DELETED',
  'DRAFT_PUBLISHED',
];

function esc(s) {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
}

function buildErrors(overrides, existing) {
  const obj = {};
  for (const k of Object.values(CODES)) {
    obj[k] = overrides[k] || existing[k] || ERROR_MESSAGES[k];
  }
  for (const k of legacyErrorAliases) {
    if (existing[k]) obj[k] = existing[k];
  }
  return obj;
}

function buildSuccess(overrides, existing) {
  const obj = {};
  for (const k of Object.values(SUCCESS)) {
    obj[k] = overrides[k] || existing[k] || SUCCESS_MESSAGES[k];
  }
  for (const k of legacySuccessAliases) {
    if (existing[k]) obj[k] = existing[k];
  }
  return obj;
}

const viErrors = buildErrors(viOverrides, existingVi.errors);
const viSuccess = buildSuccess(viOverrides, existingVi.success);

const enOverrides = {};
const enErrors = buildErrors(enOverrides, existingEn.errors);
for (const k of Object.values(CODES)) {
  if (!enErrors[k]) enErrors[k] = ERROR_MESSAGES[k];
}
const enSuccess = buildSuccess(enOverrides, existingEn.success);
for (const k of Object.values(SUCCESS)) {
  if (!enSuccess[k]) enSuccess[k] = SUCCESS_MESSAGES[k];
}

function emit(name, obj) {
  const lines = Object.entries(obj).map(([k, v]) => `  ${k}: '${esc(v)}',`);
  return `export const ${name} = {\n${lines.join('\n')}\n};\n`;
}

fs.writeFileSync(viPath, `${emit('apiErrorsVi', viErrors)}\n${emit('apiSuccessVi', viSuccess)}`);
fs.writeFileSync(enPath, `${emit('apiErrorsEn', enErrors)}\n${emit('apiSuccessEn', enSuccess)}`);

delete require.cache[require.resolve(viPath)];
const vi2 = require(viPath);
const missing = Object.values(CODES).filter((c) => !(c in vi2.apiErrorsVi));
const missingS = Object.values(SUCCESS).filter((c) => !(c in vi2.apiSuccessVi));
console.log('Missing VI errors:', missing.length);
console.log('Missing VI success:', missingS.length);
console.log('VI error keys:', Object.keys(vi2.apiErrorsVi).length);
console.log('VI success keys:', Object.keys(vi2.apiSuccessVi).length);
