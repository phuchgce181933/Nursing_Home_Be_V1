const nodemailer = require('nodemailer');

const DEFAULT_TEXTBEE_BASE_URL = 'https://api.textbee.dev';
const DEFAULT_TEXTBEE_DEVICE_ID = '68747523c430dcc62c1ef2fa';
const DEFAULT_TEXTBEE_API_KEY = 'a91dbad8-8208-4661-aebc-70afa9ecf388';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});

const sendResetPasswordEmail = async (to, resetUrl) => {
  await transporter.sendMail({
    from: process.env.MAIL_USER,
    to,
    subject: 'Reset Password',
    html: `
      <h2>Reset Password</h2>
      <p>Click the link below:</p>
      <a href="${resetUrl}">Reset Password</a>
      <p>Expires in 10 minutes.</p>
    `,
  });
};

const sendIncidentNotificationEmail = async ({
  to,
  recipientName,
  incident,
  subject,
  message,
}) => {
  if (!to) return;

  await transporter.sendMail({
    from: process.env.MAIL_USER,
    to,
    subject,
    html: `
      <h2>${subject}</h2>
      <p>Xin chào ${recipientName || 'bạn'},</p>
      <p>${message}</p>
      <p><strong>Loại sự cố:</strong> ${incident.incidentType}</p>
      <p><strong>Mức độ:</strong> ${incident.severity}</p>
      <p><strong>Thời gian:</strong> ${new Date(incident.incidentAt).toLocaleString('vi-VN')}</p>
      <p><strong>Mô tả:</strong> ${incident.description}</p>
    `,
  });
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

  await transporter.sendMail({
    from: process.env.MAIL_USER,
    to,
    subject: 'Tài khoản nhân viên đã được tạo',
    html: `
      <h2>Tài khoản nhân viên đã được tạo</h2>
      <p>Xin chào ${fullName || 'bạn'},</p>
      <p>Tài khoản nhân viên của bạn đã được tạo thành công.</p>
      <p><strong>Vai trò:</strong> ${role}</p>
      <p><strong>Mã nhân viên:</strong> ${staffCode || 'Chưa cập nhật'}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Mật khẩu tạm thời:</strong> ${password}</p>
      <p>Vui lòng đổi mật khẩu sau khi đăng nhập lần đầu.</p>
    `,
  });
};

const sendTextBeeSms = async ({ to, message }) => {
  if (!to) return;

  const apiKey =
    process.env.TEXTBEE_API_KEY || DEFAULT_TEXTBEE_API_KEY;

  const deviceId =
    process.env.TEXTBEE_DEVICE_ID || DEFAULT_TEXTBEE_DEVICE_ID;

  const normalizedPhone = to.startsWith('0')
    ? `+84${to.slice(1)}`
    : to;

  const endpoint =
    `https://api.textbee.dev/api/v1/gateway/devices/${deviceId}/send-sms`;

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

  const data = await response.text();

  console.log('TEXTBEE STATUS:', response.status);
  console.log('TEXTBEE RESPONSE:', data);

  if (!response.ok) {
    throw new Error(data || `TextBee returned ${response.status}`);
  }

  return data;
};

module.exports = {
  sendResetPasswordEmail,
  sendIncidentNotificationEmail,
  sendStaffAccountCreatedEmail,
  sendTextBeeSms,
};