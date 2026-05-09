# Hướng Dẫn Test API — UC10, UC11, UC12

> **Base URL:** `http://localhost:3000`  
> **Tool đề xuất:** Postman · Thunder Client (VS Code) · hoặc `curl`  
> **Tất cả request cần header:** `Authorization: Bearer <token>`

---

## Chuẩn Bị Trước Khi Test

### 1. Start server (Local MongoDB)

Mở PowerShell trong thư mục project, chạy:

```powershell
$env:NODE_ENV="local"; node ./bin/www
```

Khi thấy dòng `All collections initialized` là server sẵn sàng.

### 2. Tạo dữ liệu mẫu (chỉ chạy 1 lần)

Mở **tab PowerShell mới**, chạy:

```powershell
$env:NODE_ENV="local"; node scripts/seed.js
```

Output sẽ in ra các IDs — **lưu lại để dùng cho các bước test**:

```
residentId    : 69ff09c428d0159d858d4d70
doctorStaffId : 69ff09c428d0159d858d4d6e
nurseStaffId  : 69ff09c428d0159d858d4d6f
```

> Mỗi lần chạy lại seed, IDs sẽ thay đổi. Hãy copy IDs mới từ output.

### 3. Kiểm tra server đang chạy

```
GET http://localhost:3000/
```

**Kết quả mong đợi:**
```json
{ "message": "Nursing Home API running" }
```

---

## Bước 0 — Đăng Nhập Lấy Token

Tất cả endpoints đều cần Bearer token. Đăng nhập trước để lấy token.

### Login với Doctor

```
POST http://localhost:3000/api/auth/login
Content-Type: application/json
```

```json
{
  "email": "doctor@test.com",
  "password": "password123"
}
```

**Kết quả mong đợi (200):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY5ZmYwOWM0MjhkMDE1OWQ4NThkNGQ2YSIsInJvbGUiOiJkb2N0b3IiLCJpYXQiOjE3NzgzMjIyNzUsImV4cCI6MTc3ODkyNzA3NX0.YkaRMurQeVq1JaVnqfvgMCrpjr6xRAzoTMcMCm1WBak",
  "user": {
    "_id": "69ff09c428d0159d858d4d6a",
    "fullName": "Bác sĩ Nguyễn Văn A",
    "email": "doctor@test.com",
    "role": "doctor"
  }
}
```

**Copy giá trị `token` ra** → dùng cho tất cả request UC10 và UC11.

### Các tài khoản test

| Email | Password | Role | Dùng cho |
|---|---|---|---|
| `admin@test.com` | `password123` | admin | UC10, UC11 |
| `doctor@test.com` | `password123` | doctor | UC10, UC11 |
| `nurse@test.com` | `password123` | nurse | UC10, UC11 |
| `family@test.com` | `password123` | family | UC12 |

### Test sai password (401)

```json
{ "email": "doctor@test.com", "password": "sai_mat_khau" }
```

**Kết quả mong đợi (401):**
```json
{ "message": "Invalid credentials" }
```

### Xem thông tin user đang đăng nhập

```
GET http://localhost:3000/api/auth/me
Authorization: Bearer <token>
```

---

## UC10 — Quản Lý Lịch Khám và Chăm Sóc

> **Token cần dùng:** Doctor, Nurse, Admin hoặc Manager  
> **Base path:** `/api/care-appointments`

Thay các giá trị sau vào request (lấy từ output seed):
- `RESIDENT_ID` = `residentId` từ seed
- `DOCTOR_ID` = `doctorStaffId` từ seed
- `NURSE_ID` = `nurseStaffId` từ seed

---

### UC10-T01 — Tạo lịch khám thành công ✅

```
POST http://localhost:3000/api/care-appointments
Authorization: Bearer <doctor_token>
Content-Type: application/json
```

```json
{
  "residentId": "RESIDENT_ID",
  "doctorStaffId": "DOCTOR_ID",
  "nurseStaffId": "NURSE_ID",
  "scheduledStartAt": "2026-06-01T09:00:00.000Z",
  "scheduledEndAt":   "2026-06-01T09:30:00.000Z",
  "appointmentType": "Khám tổng quát",
  "notes": "Khám định kỳ hàng tháng"
}
```

**Kết quả mong đợi (201):**
```json
{
  "_id": "...",
  "residentId": { "fullName": "Cụ Nguyễn Thị D", "residentCode": "RES001" },
  "doctorStaffId": { "userId": { "fullName": "Bác sĩ Nguyễn Văn A" } },
  "nurseStaffId": { "userId": { "fullName": "Điều dưỡng Trần Thị B" } },
  "scheduledStartAt": "2026-06-01T09:00:00.000Z",
  "scheduledEndAt": "2026-06-01T09:30:00.000Z",
  "appointmentType": "Khám tổng quát",
  "status": "scheduled"
}
```

> **Lưu lại `_id`** của appointment này → dùng cho các bước tiếp theo (gọi là `APPOINTMENT_ID`).

---

### UC10-T02 — Tạo lịch khám thứ 2 (cùng ngày, giờ khác) ✅

```json
{
  "residentId": "RESIDENT_ID",
  "scheduledStartAt": "2026-06-01T14:00:00.000Z",
  "scheduledEndAt":   "2026-06-01T14:30:00.000Z",
  "appointmentType": "Khám tim mạch"
}
```

**Kết quả mong đợi (201):** Tạo thành công vì không bị xung đột giờ.

---

### UC10-T03 — Tạo lịch bị xung đột giờ ❌

```json
{
  "residentId": "RESIDENT_ID",
  "scheduledStartAt": "2026-06-01T09:15:00.000Z",
  "scheduledEndAt":   "2026-06-01T09:45:00.000Z",
  "appointmentType": "Khám trùng giờ"
}
```

**Kết quả mong đợi (409):**
```json
{
  "message": "Schedule conflict: resident already has an appointment in this time slot",
  "conflictId": "..."
}
```

---

### UC10-T04 — Tạo lịch thiếu field bắt buộc ❌

```json
{
  "scheduledStartAt": "2026-06-01T09:00:00.000Z",
  "scheduledEndAt":   "2026-06-01T09:30:00.000Z"
}
```

**Kết quả mong đợi (400):**
```json
{ "message": "residentId, scheduledStartAt and scheduledEndAt are required" }
```

---

### UC10-T05 — Xem lịch theo ngày ✅

```
GET http://localhost:3000/api/care-appointments/daily?date=2026-06-01
Authorization: Bearer <token>
```

**Kết quả mong đợi (200):** Trả về 2 lịch khám đã tạo ở T01 và T02.

```json
{
  "date": "2026-06-01T00:00:00.000Z",
  "appointments": [ ... ]
}
```

Thử ngày không có lịch:
```
GET /api/care-appointments/daily?date=2025-01-01
```
→ `appointments: []`

---

### UC10-T06 — Xem lịch theo tuần ✅

```
GET http://localhost:3000/api/care-appointments/weekly?date=2026-06-01
Authorization: Bearer <token>
```

**Kết quả mong đợi (200):**
```json
{
  "weekStart": "2026-06-01T00:00:00.000Z",
  "weekEnd": "2026-06-07T23:59:59.999Z",
  "appointments": [ ... ]
}
```

---

### UC10-T07 — Xem danh sách + lọc theo trạng thái ✅

```
GET http://localhost:3000/api/care-appointments?status=scheduled
Authorization: Bearer <token>
```

```
GET http://localhost:3000/api/care-appointments?residentId=RESIDENT_ID&from=2026-06-01&to=2026-06-30
```

**Kết quả mong đợi (200):**
```json
{
  "data": [...],
  "total": 2,
  "page": 1,
  "limit": 20,
  "totalPages": 1
}
```

---

### UC10-T08 — Xem chi tiết 1 lịch khám ✅

```
GET http://localhost:3000/api/care-appointments/APPOINTMENT_ID
Authorization: Bearer <token>
```

**Kết quả mong đợi (200):** Object đầy đủ với thông tin populate.

Thử ID không tồn tại:
```
GET /api/care-appointments/000000000000000000000001
```
→ `404 Appointment not found`

---

### UC10-T09 — Cập nhật lịch khám ✅

```
PUT http://localhost:3000/api/care-appointments/APPOINTMENT_ID
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "scheduledStartAt": "2026-06-01T10:00:00.000Z",
  "scheduledEndAt":   "2026-06-01T10:30:00.000Z",
  "notes": "Đã dời sang 10 giờ sáng"
}
```

**Kết quả mong đợi (200):** Appointment với thời gian mới.

---

### UC10-T10 — Cập nhật trạng thái ✅

```
PUT http://localhost:3000/api/care-appointments/APPOINTMENT_ID/status
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{ "status": "in_progress" }
```

**Kết quả mong đợi (200):** `"status": "in_progress"`

Chạy tiếp:
```json
{ "status": "completed" }
```
→ `"status": "completed"`

Thử status không hợp lệ:
```json
{ "status": "pending" }
```
→ `400 status must be one of: scheduled, in_progress, completed, cancelled`

---

### UC10-T11 — Gán bác sĩ phụ trách ✅

```
PUT http://localhost:3000/api/care-appointments/APPOINTMENT_ID/assign-doctor
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{ "doctorStaffId": "DOCTOR_ID" }
```

**Kết quả mong đợi (200):** Appointment với `doctorStaffId` được populate.

Huỷ gán (gửi null):
```json
{ "doctorStaffId": null }
```
→ `"doctorStaffId": null`

---

### UC10-T12 — Gán điều dưỡng phụ trách ✅

```
PUT http://localhost:3000/api/care-appointments/APPOINTMENT_ID/assign-nurse
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{ "nurseStaffId": "NURSE_ID" }
```

---

### UC10-T13 — Gửi nhắc lịch khám ✅

```
POST http://localhost:3000/api/care-appointments/APPOINTMENT_ID/reminder
Authorization: Bearer <token>
```

**Kết quả mong đợi (200):**
```json
{ "message": "Reminders sent", "recipientCount": 3 }
```

> Hệ thống tạo Notification cho bác sĩ, điều dưỡng và gia đình cư dân.  
> `recipientCount` = số người nhận notification.

---

### UC10-T14 — Xoá lịch khám ✅

> Chỉ admin, manager, doctor mới xoá được.

```
DELETE http://localhost:3000/api/care-appointments/APPOINTMENT_ID
Authorization: Bearer <doctor_token>
```

**Kết quả mong đợi (200):**
```json
{ "message": "Appointment deleted successfully" }
```

Test xoá bằng nurse token:
```
DELETE /api/care-appointments/APPOINTMENT_ID
Authorization: Bearer <nurse_token>
```
→ `403 Access forbidden: insufficient role`

---

### UC10-T15 — Không có token ❌

```
GET http://localhost:3000/api/care-appointments
```
(không có Authorization header)

**Kết quả mong đợi (401):**
```json
{ "message": "Not authenticated" }
```

---

## UC11 — Quản Lý Ghi Chú Chăm Sóc

> **Token cần dùng:** Doctor, Nurse, Admin hoặc Manager  
> **Base path:** `/api/care-notes`

---

### UC11-T01 — Tạo ghi chú sức khỏe ✅

```
POST http://localhost:3000/api/care-notes
Authorization: Bearer <doctor_token>
Content-Type: application/json
```

```json
{
  "residentId": "RESIDENT_ID",
  "noteType": "health",
  "content": "Cư dân có dấu hiệu sốt nhẹ, nhiệt độ 37.8°C. Đã cho uống thuốc hạ sốt Paracetamol 500mg.",
  "noteAt": "2026-05-09T08:00:00.000Z"
}
```

**Kết quả mong đợi (201):** Ghi chú với `authorStaffId` tự động lấy từ StaffProfile của doctor.

> **Lưu `_id`** → gọi là `NOTE_ID` dùng cho các bước sau.

---

### UC11-T02 — Tạo ghi chú ăn uống ✅

```json
{
  "residentId": "RESIDENT_ID",
  "noteType": "meal",
  "content": "Bữa trưa: cháo thịt băm, ăn hết 3/4 suất, uống đủ 200ml nước.",
  "noteAt": "2026-05-09T12:00:00.000Z"
}
```

---

### UC11-T03 — Tạo ghi chú sinh hoạt ✅

```json
{
  "residentId": "RESIDENT_ID",
  "noteType": "activity",
  "content": "Cư dân tham gia buổi tập thể dục nhẹ buổi sáng, tinh thần tốt, vận động bình thường."
}
```

---

### UC11-T04 — Tạo ghi chú với nội dung quá ngắn ❌

```json
{
  "residentId": "RESIDENT_ID",
  "noteType": "health",
  "content": "Ok"
}
```

**Kết quả mong đợi (400):**
```json
{ "message": "content is required and must be at least 5 characters" }
```

---

### UC11-T05 — Tạo ghi chú với loại không hợp lệ ❌

```json
{
  "residentId": "RESIDENT_ID",
  "noteType": "invalid_type",
  "content": "Nội dung hợp lệ đủ dài."
}
```

**Kết quả mong đợi (400):**
```json
{ "message": "noteType must be one of: meal, activity, health, general" }
```

---

### UC11-T06 — Xem danh sách tất cả ghi chú ✅

```
GET http://localhost:3000/api/care-notes
Authorization: Bearer <token>
```

**Kết quả mong đợi (200):**
```json
{
  "data": [ ... 3 ghi chú vừa tạo ... ],
  "total": 3,
  "page": 1,
  "limit": 20,
  "totalPages": 1
}
```

---

### UC11-T07 — Lọc ghi chú theo loại ✅

```
GET http://localhost:3000/api/care-notes?noteType=meal
Authorization: Bearer <token>
```

→ Chỉ trả về ghi chú `meal`.

```
GET /api/care-notes?noteType=health
```

→ Chỉ trả về ghi chú `health`.

---

### UC11-T08 — Tìm kiếm ghi chú theo nội dung ✅

```
GET http://localhost:3000/api/care-notes?search=sốt
Authorization: Bearer <token>
```

→ Tìm tất cả ghi chú có chữ "sốt" trong nội dung (không phân biệt hoa thường).

```
GET /api/care-notes?search=bữa trưa
```

→ Tìm ghi chú chứa "bữa trưa".

---

### UC11-T09 — Lọc theo ngày ✅

```
GET http://localhost:3000/api/care-notes?from=2026-05-09&to=2026-05-09&residentId=RESIDENT_ID
Authorization: Bearer <token>
```

---

### UC11-T10 — Xem lịch sử ghi chú của 1 cư dân (Timeline) ✅

```
GET http://localhost:3000/api/care-notes/history/RESIDENT_ID
Authorization: Bearer <token>
```

**Kết quả mong đợi (200):** Mảng tất cả ghi chú của cư dân, sắp xếp mới nhất trước.

Lọc theo loại:
```
GET /api/care-notes/history/RESIDENT_ID?noteType=health
```

---

### UC11-T11 — Xem chi tiết 1 ghi chú ✅

```
GET http://localhost:3000/api/care-notes/NOTE_ID
Authorization: Bearer <token>
```

---

### UC11-T12 — Cập nhật ghi chú ✅

```
PUT http://localhost:3000/api/care-notes/NOTE_ID
Authorization: Bearer <doctor_token>
Content-Type: application/json
```

```json
{
  "content": "Cư dân có dấu hiệu sốt nhẹ, nhiệt độ 37.8°C. Đã cho uống Paracetamol 500mg. Theo dõi thêm 2 tiếng.",
  "noteType": "health"
}
```

**Kết quả mong đợi (200):** Ghi chú với nội dung mới. AuditLog được ghi với `beforeData` và `afterData`.

---

### UC11-T13 — Xoá ghi chú ✅

> Chỉ admin, manager, doctor mới xoá được.

```
DELETE http://localhost:3000/api/care-notes/NOTE_ID
Authorization: Bearer <doctor_token>
```

**Kết quả mong đợi (200):**
```json
{ "message": "Care note deleted successfully" }
```

Test xoá bằng nurse token:
```
DELETE /api/care-notes/NOTE_ID
Authorization: Bearer <nurse_token>
```
→ `403 Access forbidden: insufficient role`

---

## UC12 — Theo Dõi Sức Khỏe Từ Xa (Family Portal)

> **Token cần dùng:** Đăng nhập bằng `family@test.com`  
> **Base path:** `/api/family`

### Lấy token gia đình

```
POST http://localhost:3000/api/auth/login
Content-Type: application/json
```

```json
{
  "email": "family@test.com",
  "password": "password123"
}
```

Copy `token` → dùng cho tất cả UC12.

---

### UC12-T01 — Xem danh sách người thân ✅

```
GET http://localhost:3000/api/family/residents
Authorization: Bearer <family_token>
```

**Kết quả mong đợi (200):** Mảng chứa "Cụ Nguyễn Thị D" (RES001).

---

### UC12-T02 — Xem thông tin cơ bản người thân ✅

```
GET http://localhost:3000/api/family/residents/RESIDENT_ID
Authorization: Bearer <family_token>
```

**Kết quả mong đợi (200):** Hồ sơ đầy đủ của cư dân, không có field `familyPortalAccountIds`.

---

### UC12-T03 — Truy cập người thân của người khác (403) ❌

```
GET http://localhost:3000/api/family/residents/000000000000000000000001
Authorization: Bearer <family_token>
```

**Kết quả mong đợi (403):**
```json
{ "message": "Access denied: not your relative" }
```

> Đây là cơ chế **data isolation** quan trọng nhất của UC12.

---

### UC12-T04 — Xem chỉ số sức khỏe hiện tại ✅

```
GET http://localhost:3000/api/family/residents/RESIDENT_ID/vitals
Authorization: Bearer <family_token>
```

**Kết quả mong đợi (200):** Bản ghi `MedicalRecord` mới nhất, hoặc `null` nếu chưa có.

> Để có dữ liệu: nhờ Doctor tạo MedicalRecord hoặc insert trực tiếp vào DB.

---

### UC12-T05 — Xem lịch sử sức khỏe ✅

```
GET http://localhost:3000/api/family/residents/RESIDENT_ID/health-history
Authorization: Bearer <family_token>
```

Lọc theo ngày:
```
GET /api/family/residents/RESIDENT_ID/health-history?from=2026-01-01&to=2026-05-31
```

Tìm kiếm:
```
GET /api/family/residents/RESIDENT_ID/health-history?search=huyết áp
```

---

### UC12-T06 — Xem dữ liệu biểu đồ sức khỏe ✅

Tất cả chỉ số (30 ngày gần nhất):
```
GET http://localhost:3000/api/family/residents/RESIDENT_ID/health-chart
Authorization: Bearer <family_token>
```

Chỉ 1 chỉ số cụ thể:
```
GET /api/family/residents/RESIDENT_ID/health-chart?metric=pulse&from=2026-04-01&to=2026-05-09
```

Metric hợp lệ: `bloodPressureSystolic` · `bloodPressureDiastolic` · `pulse` · `temperatureCelsius` · `oxygenSaturation` · `bloodSugar` · `weightKg`

Thử metric không hợp lệ:
```
GET /api/family/residents/RESIDENT_ID/health-chart?metric=abc
```
→ `400 metric must be one of: ...`

---

### UC12-T07 — Xem nhật ký chăm sóc (read-only) ✅

```
GET http://localhost:3000/api/family/residents/RESIDENT_ID/care-notes
Authorization: Bearer <family_token>
```

Lọc theo loại:
```
GET /api/family/residents/RESIDENT_ID/care-notes?noteType=health
GET /api/family/residents/RESIDENT_ID/care-notes?noteType=meal
GET /api/family/residents/RESIDENT_ID/care-notes?noteType=activity
```

Tìm kiếm:
```
GET /api/family/residents/RESIDENT_ID/care-notes?search=sốt
```

---

### UC12-T08 — Xem lịch sử sử dụng thuốc ✅

```
GET http://localhost:3000/api/family/residents/RESIDENT_ID/medications
Authorization: Bearer <family_token>
```

Lọc theo trạng thái:
```
GET /api/family/residents/RESIDENT_ID/medications?status=taken
GET /api/family/residents/RESIDENT_ID/medications?status=missed
```

---

### UC12-T09 — Xem đơn thuốc ✅

```
GET http://localhost:3000/api/family/residents/RESIDENT_ID/prescriptions
Authorization: Bearer <family_token>
```

Chỉ đơn đang active:
```
GET /api/family/residents/RESIDENT_ID/prescriptions?status=active
```

---

### UC12-T10 — Xem lịch hoạt động sinh hoạt ✅

```
GET http://localhost:3000/api/family/residents/RESIDENT_ID/activities
Authorization: Bearer <family_token>
```

Lọc theo ngày:
```
GET /api/family/residents/RESIDENT_ID/activities?from=2026-06-01&to=2026-06-30
```

---

### UC12-T11 — Xem lịch khám (read-only) ✅

```
GET http://localhost:3000/api/family/residents/RESIDENT_ID/care-appointments
Authorization: Bearer <family_token>
```

Chỉ lịch sắp tới:
```
GET /api/family/residents/RESIDENT_ID/care-appointments?status=scheduled&from=2026-05-09
```

---

### UC12-T12 — Tải báo cáo sức khỏe tổng hợp ✅

```
GET http://localhost:3000/api/family/residents/RESIDENT_ID/report
Authorization: Bearer <family_token>
```

Theo khoảng thời gian cụ thể:
```
GET /api/family/residents/RESIDENT_ID/report?from=2026-05-01&to=2026-05-31
```

**Kết quả mong đợi (200):**
```json
{
  "generatedAt": "2026-05-09T...",
  "period": { "from": "2026-05-01", "to": "2026-05-31" },
  "resident": { "fullName": "Cụ Nguyễn Thị D", ... },
  "summary": {
    "totalVitalsRecords": 0,
    "totalCareNotes": 3,
    "totalAppointments": 2,
    "totalMedications": 0
  },
  "vitals": [],
  "careNotes": [ ... ],
  "careAppointments": [ ... ],
  "medications": []
}
```

---

### UC12-T13 — Family dùng token của Doctor (403) ❌

> Endpoint UC12 chỉ cho phép role `family`.

```
GET http://localhost:3000/api/family/residents
Authorization: Bearer <doctor_token>
```

**Kết quả mong đợi (403):**
```json
{ "message": "Access forbidden: insufficient role" }
```

---

## Tổng Hợp Checklist

### UC10

| # | Test case | Kết quả mong đợi |
|---|---|---|
| T01 | Tạo lịch khám hợp lệ | `201` + object đầy đủ |
| T02 | Tạo lịch cùng ngày giờ khác | `201` |
| T03 | Tạo lịch trùng giờ | `409 Conflict` |
| T04 | Thiếu field bắt buộc | `400` |
| T05 | Xem lịch theo ngày | `200` + danh sách |
| T06 | Xem lịch theo tuần | `200` + weekStart/weekEnd |
| T07 | Lọc danh sách | `200` |
| T08 | Xem chi tiết / ID không tồn tại | `200` / `404` |
| T09 | Cập nhật lịch khám | `200` |
| T10 | Cập nhật trạng thái hợp lệ / không hợp lệ | `200` / `400` |
| T11 | Gán bác sĩ / huỷ gán | `200` |
| T12 | Gán điều dưỡng | `200` |
| T13 | Gửi nhắc lịch | `200` + recipientCount |
| T14 | Xoá (doctor) / Xoá (nurse) | `200` / `403` |
| T15 | Không có token | `401` |

### UC11

| # | Test case | Kết quả mong đợi |
|---|---|---|
| T01 | Tạo ghi chú health | `201` |
| T02 | Tạo ghi chú meal | `201` |
| T03 | Tạo ghi chú activity | `201` |
| T04 | Nội dung < 5 ký tự | `400` |
| T05 | noteType không hợp lệ | `400` |
| T06 | Xem danh sách | `200` |
| T07 | Lọc theo noteType | `200` |
| T08 | Tìm kiếm nội dung | `200` |
| T09 | Lọc theo ngày | `200` |
| T10 | Lịch sử timeline 1 cư dân | `200` |
| T11 | Chi tiết ghi chú | `200` |
| T12 | Cập nhật ghi chú | `200` |
| T13 | Xoá (doctor) / Xoá (nurse) | `200` / `403` |

### UC12

| # | Test case | Kết quả mong đợi |
|---|---|---|
| T01 | Xem danh sách người thân | `200` |
| T02 | Xem thông tin cơ bản | `200` |
| T03 | Truy cập người thân người khác | `403` |
| T04 | Vitals hiện tại | `200` hoặc `null` |
| T05 | Lịch sử sức khỏe | `200` |
| T06 | Dữ liệu biểu đồ / metric không hợp lệ | `200` / `400` |
| T07 | Nhật ký chăm sóc + filter + search | `200` |
| T08 | Lịch sử thuốc + filter status | `200` |
| T09 | Đơn thuốc + filter status | `200` |
| T10 | Lịch hoạt động | `200` |
| T11 | Lịch khám (read-only) | `200` |
| T12 | Báo cáo tổng hợp | `200` |
| T13 | Doctor dùng endpoint family | `403` |

---

## Audit Log — Kiểm Tra Tự Động

Sau khi thực hiện các thao tác CREATE / UPDATE / DELETE ở UC10 và UC11, kiểm tra audit log bằng cách truy vấn trực tiếp MongoDB:

```javascript
// MongoDB Compass hoặc mongosh
db.auditlogs.find({ module: "CareAppointment" }).sort({ createdAt: -1 }).limit(10)
db.auditlogs.find({ module: "CareNote" }).sort({ createdAt: -1 }).limit(10)
```

Mỗi bản ghi audit log chứa:
- `action`: CREATE / UPDATE / UPDATE_STATUS / ASSIGN_DOCTOR / ASSIGN_NURSE / DELETE
- `actorRole`: role của người thực hiện
- `beforeData`: dữ liệu trước khi thay đổi
- `afterData`: dữ liệu sau khi thay đổi
- `ipAddress`, `userAgent`
