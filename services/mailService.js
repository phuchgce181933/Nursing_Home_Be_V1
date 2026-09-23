const nodemailer = require('nodemailer');
const {
  COLORS,
  FONTS,
  BRAND,
  EMAIL_ATTACHMENTS,
  escapeHtml,
  heroIcon,
  infoRow,
  otpBoxes,
  calloutBox,
  ctaButton,
  pill,
  icon,
  renderEmailLayout,
} = require('../utils/emailBrand');

// Cổng SMS TextBee. KHÔNG đặt api key / device id mặc định ở đây: credential chỉ
// được lấy từ biến môi trường (.env), giống cách PayOS đã được xử lý trước đó.
const DEFAULT_TEXTBEE_BASE_URL = 'https://api.textbee.dev';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});

const cardTitle = (text, { color = COLORS.text } = {}) => `
  <tr>
    <td align="center" style="font-family:${FONTS.heading};font-size:24px;font-weight:700;color:${color};padding:20px 0 10px;">
      ${text}
    </td>
  </tr>
`;

const cardSubtitle = (text) => `
  <tr>
    <td align="center" style="font-family:${FONTS.body};font-size:14px;line-height:1.6;color:${COLORS.textMuted};padding-bottom:30px;">
      ${text}
    </td>
  </tr>
`;

const spacer = (h) => `<tr><td style="padding-bottom:${h}px;line-height:1px;font-size:1px;">&nbsp;</td></tr>`;

/* ───────────────────────── 1. Reset Password ───────────────────────── */

const sendResetPasswordEmail = async (to, resetUrl) => {
  const bodyHtml = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td align="center">${heroIcon('lock')}</td></tr>
      ${cardTitle('Đặt lại mật khẩu của bạn')}
      ${cardSubtitle('Chúng tôi vừa nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn. Nhấn nút bên dưới để tạo mật khẩu mới.')}
      <tr><td align="center">${ctaButton({ label: 'Đặt lại mật khẩu', href: resetUrl })}</td></tr>
      ${spacer(28)}
      <tr>
        <td>${calloutBox({
          iconName: 'shield',
          color: COLORS.warning,
          bg: COLORS.warningLight,
          text: 'Liên kết này sẽ hết hạn sau <strong>10 phút</strong>. Nếu bạn không yêu cầu đặt lại mật khẩu, vui lòng bỏ qua email này hoặc liên hệ đội ngũ hỗ trợ nếu bạn nghi ngờ tài khoản của mình gặp rủi ro.',
        })}</td>
      </tr>
    </table>
  `;

  await transporter.sendMail({
    from: `"${BRAND.senderName}" <${process.env.MAIL_USER}>`,
    to,
    subject: 'Đặt lại mật khẩu của bạn',
    html: renderEmailLayout({ preheader: 'Yêu cầu đặt lại mật khẩu — liên kết hết hạn sau 10 phút.', bodyHtml }),
    text: `Đặt lại mật khẩu của bạn\n\nNhấn vào liên kết sau để đặt lại mật khẩu (hết hạn sau 10 phút):\n${resetUrl}\n\nNếu bạn không yêu cầu, vui lòng bỏ qua email này.`,
    attachments: EMAIL_ATTACHMENTS,
  });
};

/* ───────────────────────── 2. OTP Verification ───────────────────────── */

const sendEmailVerificationOtp = async ({ to, code, expiresMinutes = 10 }) => {
  if (!to) return;

  const bodyHtml = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td align="center">${heroIcon('mailCheck', { accent: COLORS.success, bg: '#E7F4E8' })}</td></tr>
      ${cardTitle('Xác thực email của bạn')}
      ${cardSubtitle('Nhập mã xác thực bên dưới để hoàn tất xác nhận email mới của bạn.')}
      <tr><td align="center">${otpBoxes(code)}</td></tr>
      ${spacer(28)}
      <tr>
        <td>${calloutBox({
          iconName: 'shield',
          color: COLORS.warning,
          bg: COLORS.warningLight,
          text: `Mã xác thực sẽ hết hạn sau <strong>${expiresMinutes} phút</strong>. Không chia sẻ mã này với bất kỳ ai, kể cả nhân viên của ${escapeHtml(BRAND.name)}.`,
        })}</td>
      </tr>
    </table>
  `;

  await transporter.sendMail({
    from: `"${BRAND.senderName}" <${process.env.MAIL_USER}>`,
    to,
    subject: 'Mã xác thực email của bạn',
    html: renderEmailLayout({ preheader: `Mã xác thực của bạn: ${code}`, bodyHtml }),
    text: `Mã xác thực email của bạn là: ${code}\nMã sẽ hết hạn sau ${expiresMinutes} phút.`,
    attachments: EMAIL_ATTACHMENTS,
  });
};

/* ───────────────────────── 3. Emergency Alert (Incident) ───────────────────────── */

const ROLE_BASE_PATH = {
  admin: '/admin',
  doctor: '/doctor',
  nurse: '/nurse',
  caregiver: '/caregiver',
  family: '/family',
};

const SEVERITY_LABELS = { low: 'Thấp', medium: 'Trung bình', high: 'Cao', critical: 'Nghiêm trọng' };
const STATUS_LABELS = { open: 'Đang mở', investigating: 'Đang điều tra', resolved: 'Đã giải quyết', closed: 'Đã đóng' };
const SEVERITY_SOLID = { low: COLORS.success, medium: COLORS.warning, high: COLORS.danger, critical: COLORS.danger };
const STATUS_SOFT = {
  open: { bg: COLORS.warningLight, color: '#9A6B12' },
  investigating: { bg: COLORS.primaryLight, color: COLORS.primaryHover },
  resolved: { bg: '#E7F4E8', color: '#2E7D32' },
  closed: { bg: COLORS.bg, color: COLORS.textMuted },
};

// Consistent amber row icons for this card, matching the reference — the
// severity/status *values* (pills) carry the color signal, not the icons.
const incidentRowIcon = (name, label, value) =>
  infoRow({ iconName: name, label, value, iconColor: COLORS.warning, iconBg: COLORS.warningLight });

const sendIncidentNotificationEmail = async ({
  to,
  recipientName,
  recipientRole,
  incident,
  subject,
  message,
  assignedStaffNames,
  residentName,
}) => {
  if (!to) return;

  const severitySolid = SEVERITY_SOLID[incident.severity] || COLORS.warning;
  const statusSoft = STATUS_SOFT[incident.status] || { bg: COLORS.bg, color: COLORS.textMuted };
  const basePath = ROLE_BASE_PATH[recipientRole] || '/admin';
  const viewUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}${basePath}/incidents`;

  const bodyHtml = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td align="center">${heroIcon('triangleAlert', { accent: COLORS.danger, bg: COLORS.dangerLight })}</td></tr>
      ${cardTitle(escapeHtml(subject || 'Cảnh báo sự cố khẩn cấp'), { color: COLORS.danger })}
      <tr>
        <td style="font-family:${FONTS.body};font-size:14px;line-height:1.6;color:${COLORS.text};padding-bottom:22px;">
          Xin chào <strong>${escapeHtml(recipientName || 'bạn')}</strong>,<br />
          ${escapeHtml(message || 'Một sự cố mới cần được bạn xử lý.')}
        </td>
      </tr>

      <tr>
        <td style="background-color:${COLORS.bg};border:1px solid ${COLORS.border};border-radius:14px;padding:4px 18px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="padding:14px 0 6px;border-bottom:1px solid ${COLORS.border};">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td valign="middle">${icon('clipboard', { size: 15, color: COLORS.text, strokeWidth: 1.9 })}</td>
                    <td valign="middle" style="padding-left:8px;font-family:${FONTS.body};font-size:11.5px;font-weight:700;letter-spacing:0.5px;color:${COLORS.text};text-transform:uppercase;">Chi tiết sự cố</td>
                  </tr>
                </table>
              </td>
            </tr>
            ${incidentRowIcon('activity', 'Loại sự cố', escapeHtml(incident.incidentType || 'N/A'))}
            ${incidentRowIcon('user', 'Cư dân', escapeHtml(residentName || 'N/A'))}
            <tr>
              <td style="padding:14px 0;border-bottom:1px solid ${COLORS.border};">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                  <tr>
                    <td width="36" valign="middle"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="36" height="36" align="center" valign="middle" style="width:36px;height:36px;background-color:${COLORS.warningLight};border-radius:50%;">${icon('triangleAlert', { size: 16, color: COLORS.warning, strokeWidth: 1.8 })}</td></tr></table></td>
                    <td style="padding-left:12px;" valign="middle"><span style="font-family:${FONTS.body};font-size:13.5px;color:${COLORS.textMuted};">Mức độ ưu tiên</span></td>
                    <td align="right" valign="middle">${pill(escapeHtml(SEVERITY_LABELS[incident.severity] || incident.severity).toUpperCase(), { color: severitySolid, solid: true })}</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:14px 0;border-bottom:1px solid ${COLORS.border};">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                  <tr>
                    <td width="36" valign="middle"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="36" height="36" align="center" valign="middle" style="width:36px;height:36px;background-color:${COLORS.warningLight};border-radius:50%;">${icon('checkCircle', { size: 16, color: COLORS.warning, strokeWidth: 1.8 })}</td></tr></table></td>
                    <td style="padding-left:12px;" valign="middle"><span style="font-family:${FONTS.body};font-size:13.5px;color:${COLORS.textMuted};">Trạng thái</span></td>
                    <td align="right" valign="middle">${pill(escapeHtml(STATUS_LABELS[incident.status] || incident.status).toUpperCase(), { bg: statusSoft.bg, color: statusSoft.color })}</td>
                  </tr>
                </table>
              </td>
            </tr>
            ${incidentRowIcon('clock', 'Thời gian', escapeHtml(new Date(incident.incidentAt).toLocaleString('vi-VN')))}
            ${incident.location ? incidentRowIcon('mapPin', 'Địa điểm', escapeHtml(incident.location)) : ''}
            ${infoRow({ iconName: 'users', label: 'Nhân viên xử lý', value: escapeHtml(assignedStaffNames || 'Chưa phân công'), iconColor: COLORS.warning, iconBg: COLORS.warningLight, isLast: true })}
          </table>
        </td>
      </tr>

      ${incident.description ? `
      <tr><td style="padding-top:18px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td width="24" valign="top">${icon('messageSquare', { size: 16, color: COLORS.textMuted, strokeWidth: 1.8 })}</td>
            <td style="padding-left:10px;font-family:${FONTS.body};font-size:13.5px;line-height:1.65;color:${COLORS.textMuted};"><strong style="color:${COLORS.text};">Mô tả:</strong> ${escapeHtml(incident.description)}</td>
          </tr>
        </table>
      </td></tr>` : ''}

      ${spacer(26)}
      <tr><td align="center">${ctaButton({ label: 'Xem chi tiết & xử lý ngay', href: viewUrl, color: COLORS.danger, hover: '#B93E3A' })}</td></tr>
      ${spacer(22)}
      <tr>
        <td>${calloutBox({
          iconName: 'triangleAlert',
          color: COLORS.warning,
          bg: COLORS.warningLight,
          text: 'Đây là thông báo tự động từ hệ thống. Vui lòng không trả lời email này.',
        })}</td>
      </tr>
    </table>
  `;

  await transporter.sendMail({
    from: `"${BRAND.senderName}" <${process.env.MAIL_USER}>`,
    to,
    subject,
    html: renderEmailLayout({ preheader: message || subject, bodyHtml }),
    text: [
      subject,
      `Xin chào ${recipientName || 'bạn'},`,
      message,
      `Loại sự cố: ${incident.incidentType || 'N/A'}`,
      `Cư dân: ${residentName || 'N/A'}`,
      `Mức độ ưu tiên: ${SEVERITY_LABELS[incident.severity] || incident.severity}`,
      `Trạng thái: ${STATUS_LABELS[incident.status] || incident.status}`,
      `Thời gian: ${new Date(incident.incidentAt).toLocaleString('vi-VN')}`,
      incident.location ? `Địa điểm: ${incident.location}` : null,
      `Nhân viên xử lý: ${assignedStaffNames || 'Chưa phân công'}`,
      incident.description ? `Mô tả: ${incident.description}` : null,
      `Xem chi tiết: ${viewUrl}`,
    ].filter(Boolean).join('\n'),
    attachments: EMAIL_ATTACHMENTS,
  });
};

/* ───────────────────────── 4. Staff Account Created ───────────────────────── */

const STAFF_ROLE_LABELS = {
  admin: 'Quản trị viên',
  doctor: 'Bác sĩ',
  nurse: 'Điều dưỡng',
  pharmacist: 'Dược sĩ',
  caregiver: 'Trợ lý chăm sóc',
  staff: 'Nhân viên',
  family: 'Gia đình',
  system: 'Hệ thống',
};

const sendStaffAccountCreatedEmail = async ({
  to,
  fullName,
  role,
  staffCode,
  email,
  password,
}) => {
  if (!to) return;

  const roleLabel = STAFF_ROLE_LABELS[role] || role;
  const emailValue = escapeHtml(email);

  const bodyHtml = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td align="center">${heroIcon('userCheck')}</td></tr>
      ${cardTitle('Tài khoản nhân viên đã được tạo')}
      ${cardSubtitle(`Xin chào <strong style="color:${COLORS.text};">${escapeHtml(fullName || 'bạn')}</strong>, tài khoản của bạn đã sẵn sàng. Vui lòng dùng thông tin dưới đây để đăng nhập lần đầu.`)}

      <tr>
        <td style="background-color:${COLORS.bg};border:1px solid ${COLORS.border};border-radius:14px;padding:6px 18px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            ${infoRow({ iconName: 'user', label: 'Vai trò', value: escapeHtml(roleLabel) })}
            ${infoRow({ iconName: 'idCard', label: 'Mã nhân viên', value: escapeHtml(staffCode || 'Chưa cập nhật') })}
            ${infoRow({ iconName: 'mail', label: 'Email', value: `<a href="mailto:${emailValue}" style="color:${COLORS.primary};text-decoration:underline;">${emailValue}</a>` })}
            ${infoRow({ iconName: 'lock', label: 'Mật khẩu tạm thời', value: escapeHtml(password), isLast: true })}
          </table>
        </td>
      </tr>

      ${spacer(22)}
      <tr>
        <td>${calloutBox({
          iconName: 'shield',
          color: COLORS.warning,
          bg: COLORS.warningLight,
          text: 'Vì lý do bảo mật, vui lòng đổi mật khẩu ngay sau khi đăng nhập lần đầu tiên. Không chia sẻ thông tin đăng nhập của bạn cho bất kỳ ai.',
        })}</td>
      </tr>

      ${spacer(30)}
      <tr><td align="center">${ctaButton({ label: 'Đăng nhập ngay', href: BRAND.loginUrl })}</td></tr>
      <tr>
        <td align="center" style="padding-top:12px;font-family:${FONTS.body};font-size:12px;color:${COLORS.textMuted};">
          Nếu bạn không yêu cầu tạo tài khoản này, vui lòng liên hệ Quản trị hệ thống ngay lập tức.
        </td>
      </tr>
    </table>
  `;

  await transporter.sendMail({
    from: `"${BRAND.senderName}" <${process.env.MAIL_USER}>`,
    to,
    subject: 'Tài khoản nhân viên đã được tạo thành công',
    html: renderEmailLayout({
      preheader: `Tài khoản ${roleLabel} của bạn đã sẵn sàng — thông tin đăng nhập bên trong.`,
      bodyHtml,
    }),
    text: [
      `Tài khoản nhân viên đã được tạo thành công.`,
      `Xin chào ${fullName || 'bạn'},`,
      `Vai trò: ${roleLabel}`,
      `Mã nhân viên: ${staffCode || 'Chưa cập nhật'}`,
      `Email: ${email}`,
      `Mật khẩu tạm thời: ${password}`,
      `Vui lòng đổi mật khẩu sau khi đăng nhập lần đầu. Đăng nhập tại: ${BRAND.loginUrl}`,
    ].join('\n'),
    attachments: EMAIL_ATTACHMENTS,
  });
};

const sendFamilyAccountCreatedEmail = async ({
  to,
  fullName,
  residentName,
  email,
  password,
}) => {
  if (!to) return;

  const emailValue = escapeHtml(email);

  const bodyHtml = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td align="center">${heroIcon('userCheck')}</td></tr>
      ${cardTitle('Tài khoản người thân đã được tạo')}
      ${cardSubtitle(`Xin chào <strong style="color:${COLORS.text};">${escapeHtml(fullName || 'bạn')}</strong>, tài khoản của bạn đã sẵn sàng để theo dõi và chăm sóc người thân tại ${escapeHtml(BRAND.name)}.`)}

      <tr>
        <td style="background-color:${COLORS.bg};border:1px solid ${COLORS.border};border-radius:14px;padding:6px 18px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            ${infoRow({ iconName: 'user', label: 'Người thân', value: escapeHtml(residentName || 'Chưa cập nhật') })}
            ${infoRow({ iconName: 'mail', label: 'Email đăng nhập', value: `<a href="mailto:${emailValue}" style="color:${COLORS.primary};text-decoration:underline;">${emailValue}</a>` })}
            ${infoRow({ iconName: 'lock', label: 'Mật khẩu tạm thời', value: escapeHtml(password), isLast: true })}
          </table>
        </td>
      </tr>

      ${spacer(22)}
      <tr>
        <td>${calloutBox({
          iconName: 'shield',
          color: COLORS.warning,
          bg: COLORS.warningLight,
          text: 'Vì lý do bảo mật, vui lòng đổi mật khẩu ngay sau khi đăng nhập lần đầu tiên. Không chia sẻ thông tin đăng nhập của bạn cho bất kỳ ai.',
        })}</td>
      </tr>

      ${spacer(30)}
      <tr><td align="center">${ctaButton({ label: 'Đăng nhập ngay', href: BRAND.loginUrl })}</td></tr>
      <tr>
        <td align="center" style="padding-top:12px;font-family:${FONTS.body};font-size:12px;color:${COLORS.textMuted};">
          Nếu bạn không yêu cầu tạo tài khoản này, vui lòng liên hệ chúng tôi ngay lập tức.
        </td>
      </tr>
    </table>
  `;

  await transporter.sendMail({
    from: `"${BRAND.senderName}" <${process.env.MAIL_USER}>`,
    to,
    subject: 'Tài khoản người thân đã được tạo thành công',
    html: renderEmailLayout({
      preheader: 'Tài khoản theo dõi người thân của bạn đã sẵn sàng — thông tin đăng nhập bên trong.',
      bodyHtml,
    }),
    text: [
      `Tài khoản người thân đã được tạo thành công.`,
      `Xin chào ${fullName || 'bạn'},`,
      `Người thân: ${residentName || 'Chưa cập nhật'}`,
      `Email đăng nhập: ${email}`,
      `Mật khẩu tạm thời: ${password}`,
      `Vui lòng đổi mật khẩu sau khi đăng nhập lần đầu. Đăng nhập tại: ${BRAND.loginUrl}`,
    ].join('\n'),
    attachments: EMAIL_ATTACHMENTS,
  });
};

/* ───────────────────────── SMS (unchanged) ───────────────────────── */

/** Che số điện thoại trước khi ghi log: chỉ giữ 4 số cuối. */
const maskPhone = (phone) => String(phone || '').replace(/.(?=.{4})/g, '*');

const sendTextBeeSms = async ({ to, message }) => {
  if (!to) return;

  const apiKey = process.env.TEXTBEE_API_KEY;
  const deviceId = process.env.TEXTBEE_DEVICE_ID;
  const baseUrl = process.env.TEXTBEE_BASE_URL || DEFAULT_TEXTBEE_BASE_URL;

  if (!apiKey || !deviceId) {
    // Thà báo lỗi rõ ràng còn hơn im lặng coi như đã gửi được SMS.
    throw new Error('Chưa cấu hình TEXTBEE_API_KEY / TEXTBEE_DEVICE_ID trong .env');
  }

  // TextBee yêu cầu số ở định dạng quốc tế (E.164). Số VN nội địa bắt đầu bằng 0
  // → đổi thành +84…; số đã có +84 hoặc 84 thì giữ/chuẩn hoá lại.
  const digits = String(to).trim().replace(/[\s.()-]/g, '');
  const normalizedPhone = digits.startsWith('+')
    ? digits
    : digits.startsWith('0')
      ? `+84${digits.slice(1)}`
      : digits.startsWith('84')
        ? `+${digits}`
        : digits;

  // Giữ nguyên endpoint gắn thiết bị như trước (đã chạy đúng), chỉ đưa credential ra .env.
  const endpoint = `${baseUrl}/api/v1/gateway/devices/${deviceId}/send-sms`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      recipients: [normalizedPhone],
      message,
    }),
  });

  const raw = await response.text();
  let payload = null;
  try { payload = JSON.parse(raw); } catch { payload = null; }

  if (!response.ok) {
    // Không log nội dung `message` (có thể chứa mã OTP) và không log api key.
    console.error(`[TextBee] Gửi tới ${maskPhone(normalizedPhone)} thất bại — HTTP ${response.status}: ${raw.slice(0, 300)}`);
    throw new Error(raw || `TextBee returned ${response.status}`);
  }

  const result = payload?.data ?? {};
  // "Đã nhận vào hàng đợi" KHÔNG phải là "đã gửi tới máy" — ghi đúng mức độ.
  console.log(
    `[TextBee] Đã nhận yêu cầu gửi tới ${maskPhone(normalizedPhone)} | batch=${result.smsBatchId || '-'} | recipients=${result.recipientCount ?? '-'} (chưa phải xác nhận đã giao)`,
  );

  return payload ?? raw;
};

module.exports = {
  sendResetPasswordEmail,
  sendIncidentNotificationEmail,
  sendStaffAccountCreatedEmail,
  sendFamilyAccountCreatedEmail,
  sendEmailVerificationOtp,
  sendTextBeeSms,
};
