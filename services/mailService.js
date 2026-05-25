const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});

const sendResetPasswordEmail = async (
  to,
  resetUrl
) => {
  await transporter.sendMail({
    from: process.env.MAIL_USER,
    to,
    subject: 'Reset Password',
    html: `
      <h2>Reset Password</h2>

      <p>Click the link below:</p>

      <a href="${resetUrl}">
        Reset Password
      </a>

      <p>Expires in 10 minutes.</p>
    `,
  });
};

module.exports = {
  sendResetPasswordEmail,
};