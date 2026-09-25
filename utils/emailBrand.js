// Shared visual system for transactional emails — "Minimal Luxury Healthcare
// Enterprise" per the An Nhiên brand brief. One shell (fonts, header, card,
// footer) so every email in the app reads as the same product instead of
// each mailService function hand-rolling its own HTML.
const path = require('path');
const fs = require('fs');

const COLORS = {
  primary: '#6B7755',
  primaryHover: '#596547',
  primaryLight: '#EDF2E8',
  secondary: '#A6B08C',
  accent: '#C5A777',
  bg: '#F7F8F5',
  surface: '#FFFFFF',
  border: '#E7EADF',
  text: '#2F3A2E',
  textMuted: '#6C7566',
  danger: '#D94A45',
  dangerLight: '#FBEAE9',
  warning: '#E39C28',
  warningLight: '#FDF3E1',
  success: '#4CAF50',
};

const FONTS = {
  // Times New Roman is a system font on every mail client — no webfont
  // loading needed (and thus no fallback risk on clients that strip
  // remote CSS, e.g. Outlook desktop).
  heading: `'Times New Roman', Times, serif`,
  body: `'Times New Roman', Times, serif`,
  // Chỉ dùng cho chuỗi cần copy chính xác từng ký tự (mã đặt lại mật khẩu):
  // serif dễ gây nhầm 1/l và 0/O khi người dùng phải tự đối chiếu.
  mono: `Consolas, 'Courier New', Courier, monospace`,
};

const BRAND = {
  name: 'An Nhiên',
  senderName: 'Viện Dưỡng Lão An Nhiên',
  legalName: 'An Nhiên Care Home',
  tagline: 'Chăm sóc tận tâm – An toàn – Chuyên nghiệp',
  address: '68 Đường Nguyễn Văn Cừ, Phường An Khánh, Quận Ninh Kiều, TP. Cần Thơ',
  hotline: '1800 1234 (miễn phí)',
  supportEmail: 'annhiencarehome@gmail.com',
  hours: '8h00 - 20h00 (bao gồm ngày Lễ, Tết)',
  loginUrl: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/login`,
  logoCid: 'annhien-logo',
};

const LOGO_ATTACHMENT = {
  filename: 'logo-annhien.png',
  path: path.join(__dirname, '..', 'assets', 'email', 'logo-annhien.png'),
  cid: BRAND.logoCid,
};

// CID inline images render fine in the email body, but Gmail (and other
// clients) also lists every one of them in the "N attachments" tray at the
// bottom of the email — confirmed by a real send with 22 icon attachments.
// A normal <img src="https://..."> is not a MIME part, so nothing shows
// there. scripts/upload-email-assets.js hosts the logo + icon set on
// Cloudinary (already used elsewhere in this project) once and writes this
// manifest; HOSTED_URLS[cid] -> secure_url. Falls back to the cid: form
// (still works, just triggers the attachment tray) if the manifest or a
// specific entry is missing, e.g. before the upload script has been run.
const HOSTED_URLS_PATH = path.join(__dirname, '..', 'assets', 'email', 'hosted-urls.json');
const HOSTED_URLS = fs.existsSync(HOSTED_URLS_PATH)
  ? JSON.parse(fs.readFileSync(HOSTED_URLS_PATH, 'utf8'))
  : {};

const imageSrc = (cid) => HOSTED_URLS[cid] || `cid:${cid}`;

const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));

// Lucide-outline-style paths (viewBox 0 0 24 24, stroke-based). Kept to the
// small set this email system actually uses.
const ICON_PATHS = {
  shield: '<path d="M20 13c0 5-3.5 7.5-7.35 8.95a1 1 0 0 1-1.3 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  checkCircle: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  userCheck: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/>',
  headphones: '<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>',
  mapPin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  triangleAlert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  idCard: '<rect width="18" height="14" x="3" y="5" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M15 8h3"/><path d="M15 12h3"/><path d="M6 16h12"/>',
  arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  externalLink: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  mailCheck: '<path d="M22 13V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/><path d="m16 19 2 2 4-4"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  messageSquare: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  clipboard: '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
};

// Inline <svg> is stripped by most real mail clients (Gmail renders the
// colored circle background but drops the glyph inside — confirmed by
// testing an actual send, not just the artifact preview). Icons ship as
// pre-rasterized PNGs referenced by CID instead, generated once via
// scripts/generate-email-icons.js — same technique that already works for
// the logo. This map is the single source of truth for which (icon, color)
// combinations exist as generated assets.
const ICON_COLOR_KEYS = {
  [COLORS.primary]: 'primary',
  [COLORS.warning]: 'warning',
  [COLORS.danger]: 'danger',
  [COLORS.success]: 'success',
  [COLORS.textMuted]: 'muted',
  [COLORS.text]: 'text',
  '#FFFFFF': 'white',
};

const iconSlug = (name, colorKey) => `${name.replace(/([A-Z])/g, '-$1').toLowerCase()}-${colorKey}`;

const ICONS_DIR = path.join(__dirname, '..', 'assets', 'email', 'icons');

const ICON_ATTACHMENTS = fs.existsSync(ICONS_DIR)
  ? fs.readdirSync(ICONS_DIR)
      .filter((f) => f.endsWith('.png'))
      .map((f) => ({ filename: f, path: path.join(ICONS_DIR, f), cid: f.replace(/\.png$/, '') }))
  : [];

// Only attach assets that don't already have a hosted URL — once
// scripts/upload-email-assets.js has run for an icon, it's referenced by
// URL and needs no MIME attachment at all (see imageSrc() above). Anything
// still missing a hosted URL falls back to a CID attachment so it isn't
// simply broken.
const EMAIL_ATTACHMENTS = [LOGO_ATTACHMENT, ...ICON_ATTACHMENTS].filter((a) => !HOSTED_URLS[a.cid]);

const icon = (name, { size = 20, color = COLORS.primary } = {}) => {
  const colorKey = ICON_COLOR_KEYS[color] || 'primary';
  const cid = iconSlug(name, colorKey);
  return `<img src="${imageSrc(cid)}" width="${size}" height="${size}" alt="" style="display:block;border:0;width:${size}px;height:${size}px;" />`;
};

// The large hero icon at the top of every card.
const heroIcon = (name, { accent = COLORS.primary, bg = COLORS.primaryLight } = {}) => `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">
    <tr>
      <td width="72" height="72" align="center" valign="middle" style="width:72px;height:72px;background-color:${bg};border-radius:50%;">
        ${icon(name, { size: 30, color: accent, strokeWidth: 1.6 })}
      </td>
    </tr>
  </table>
`;

// A small circular icon used inside info-card rows.
const rowIcon = (name, { accent = COLORS.primary, bg = COLORS.primaryLight } = {}) => `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td width="36" height="36" align="center" valign="middle" style="width:36px;height:36px;background-color:${bg};border-radius:50%;">
        ${icon(name, { size: 16, color: accent, strokeWidth: 1.8 })}
      </td>
    </tr>
  </table>
`;

// One "icon | label ......... value" row inside a light info card.
const infoRow = ({ iconName, label, value, isLast = false, iconColor, iconBg }) => `
  <tr>
    <td style="padding:14px 0;${isLast ? '' : `border-bottom:1px solid ${COLORS.border};`}">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr>
          <td width="36" valign="middle">${rowIcon(iconName, { accent: iconColor, bg: iconBg })}</td>
          <td style="padding-left:12px;" valign="middle">
            <span style="font-family:${FONTS.body};font-size:13.5px;color:${COLORS.textMuted};">${label}</span>
          </td>
          <td align="right" valign="middle">
            <span style="font-family:${FONTS.body};font-size:14px;font-weight:600;color:${COLORS.text};">${value}</span>
          </td>
        </tr>
      </table>
    </td>
  </tr>
`;

/**
 * Một khối chứa chuỗi bí mật để người dùng bôi đen và COPY (mã đặt lại mật khẩu).
 * Khác `otpBoxes`: mã ở đây nằm liền một chuỗi, vì tách ra từng ô thì bôi đen sẽ
 * dính khoảng trắng giữa các ký tự và người dùng dán vào app bị sai.
 *
 * - font monospace: người dùng phân biệt được 0/O, 1/l khi phải tự đối chiếu;
 * - `word-break:break-all`: chuỗi dài tự xuống dòng thay vì phá vỡ khung email;
 * - `user-select:all`: bấm một lần là chọn trọn mã trên client có hỗ trợ CSS.
 */
const codeBlock = (value, { fontSize = 13, letterSpacing = 0.5 } = {}) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${COLORS.primaryLight};border:1px solid ${COLORS.border};border-radius:12px;">
    <tr>
      <td align="center" style="padding:16px 18px;">
        <span style="font-family:${FONTS.mono};font-size:${fontSize}px;line-height:1.7;font-weight:700;color:${COLORS.text};word-break:break-all;-webkit-user-select:all;user-select:all;letter-spacing:${letterSpacing}px;">
          ${escapeHtml(value)}
        </span>
      </td>
    </tr>
  </table>
`;

// Six individually-boxed OTP digits — the visual focus of the OTP email.
const otpBoxes = (code) => {
  const digits = String(code || '').split('');
  const cells = digits
    .map(
      (d) => `
      <td style="padding:0 4px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="46" height="56">
          <tr>
            <td align="center" valign="middle" style="width:46px;height:56px;background-color:${COLORS.primaryLight};border:1px solid ${COLORS.border};border-radius:12px;font-family:${FONTS.heading};font-size:24px;font-weight:700;color:${COLORS.primary};">
              ${escapeHtml(d)}
            </td>
          </tr>
        </table>
      </td>`
    )
    .join('');
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">
      <tr>${cells}</tr>
    </table>
  `;
};

const calloutBox = ({ iconName, color, bg, text }) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${bg};border-radius:14px;">
    <tr>
      <td style="padding:16px 18px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td width="24" valign="top" style="padding-top:1px;">${icon(iconName, { size: 18, color, strokeWidth: 1.9 })}</td>
            <td style="padding-left:12px;font-family:${FONTS.body};font-size:12.5px;line-height:1.65;color:${color};">
              ${text}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
`;

// A small rounded status/severity chip, e.g. "CAO" (solid) or "ĐANG MỞ" (soft).
const pill = (text, { bg, color, solid = false }) => `
  <span style="display:inline-block;padding:4px 14px;border-radius:999px;background-color:${solid ? color : bg};color:${solid ? '#FFFFFF' : color};font-family:${FONTS.body};font-size:11.5px;font-weight:700;letter-spacing:0.4px;">
    ${text}
  </span>
`;

const ctaButton = ({ label, href, color = COLORS.primary, hover = COLORS.primaryHover, textColor = '#FFFFFF', trailingIcon = 'chevronRight' }) => `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">
    <tr>
      <td align="center" style="background-color:${color};border-radius:12px;">
        <a href="${href}" style="display:inline-block;min-width:220px;height:52px;line-height:52px;padding:0 26px;font-family:${FONTS.body};font-size:15px;font-weight:600;color:${textColor};text-decoration:none;letter-spacing:0.2px;text-align:center;">
          ${label}${trailingIcon ? `<span style="display:inline-block;vertical-align:middle;margin-left:6px;position:relative;top:2px;">${icon(trailingIcon, { size: 16, color: textColor, strokeWidth: 2.2 })}</span>` : ''}
        </a>
      </td>
    </tr>
  </table>
`;

// Hand-drawn botanical sprig flanking the logo — a nod to the brief's "soft
// botanical corners" without the fragility of full corner background art
// (position:absolute background illustrations) across real email clients.
// mirror=true flips it for the right-hand side.
const leafSprig = ({ opacity = 0.55, mirror = false } = {}) => `
  <svg width="96" height="130" viewBox="0 0 96 130" fill="none" xmlns="http://www.w3.org/2000/svg" style="opacity:${opacity};${mirror ? 'transform:scaleX(-1);' : ''}">
    <path d="M94 4C70 18 60 34 60 52c0 20 10 34 10 34" stroke="${COLORS.secondary}" stroke-width="1.3" stroke-linecap="round"/>
    <path d="M60 52c-14 4-22 0-30-6" stroke="${COLORS.secondary}" stroke-width="1.1" stroke-linecap="round"/>
    <path d="M66 30c-16 2-26-2-34-10" stroke="${COLORS.secondary}" stroke-width="1.1" stroke-linecap="round"/>
    <path d="M78 12c4 3 4 9 0 12-4-3-4-9 0-12Z" fill="${COLORS.secondary}"/>
    <path d="M52 22c4 3 4 9 0 12-4-3-4-9 0-12Z" fill="${COLORS.accent}"/>
    <path d="M32 42c4 3 4 9 0 12-4-3-4-9 0-12Z" fill="${COLORS.secondary}"/>
    <path d="M66 58c4 3 4 9 0 12-4-3-4-9 0-12Z" fill="${COLORS.accent}"/>
    <path d="M40 66c4 3 4 9 0 12-4-3-4-9 0-12Z" fill="${COLORS.secondary}"/>
    <path d="M64 94c4 3 4 9 0 12-4-3-4-9 0-12Z" fill="${COLORS.secondary}"/>
  </svg>
`;

// One footer info line (icon + label + value), stacked vertically rather
// than side-by-side columns so long values (like the full address) never
// get cramped into a narrow column.
const footerContactRow = (iconName, label, value, isLast = false) => `
  <tr>
    <td style="padding:11px 0;${isLast ? '' : `border-bottom:1px solid ${COLORS.border};`}">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr>
          <td width="28" valign="top">${icon(iconName, { size: 16, color: COLORS.primary })}</td>
          <td style="padding-left:10px;" valign="top">
            <div style="font-family:${FONTS.body};font-size:11.5px;font-weight:700;color:${COLORS.text};letter-spacing:0.3px;text-transform:uppercase;margin-bottom:2px;">${label}</div>
            <div style="font-family:${FONTS.body};font-size:12.5px;line-height:1.5;color:${COLORS.textMuted};">${value}</div>
          </td>
        </tr>
      </table>
    </td>
  </tr>
`;

// bodyHtml: the content specific to one email (hero icon, title, subtitle,
// content card, CTA, ...) rendered inside the white card.
const renderEmailLayout = ({ preheader = '', bodyHtml }) => `
<!DOCTYPE html>
<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light" />
    <title>${escapeHtml(BRAND.name)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:${COLORS.bg};">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${COLORS.bg};">
      <tr>
        <td align="center" style="padding:40px 16px;">
          <table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:640px;">

            <!-- Header -->
            <tr>
              <td align="center" style="padding-bottom:14px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td valign="middle" style="padding-right:6px;">${leafSprig({ opacity: 0.5 })}</td>
                    <td valign="middle">
                      <img src="${imageSrc(BRAND.logoCid)}" width="104" height="104" alt="${escapeHtml(BRAND.name)}" style="display:block;width:104px;height:104px;border:0;border-radius:50%;" />
                    </td>
                    <td valign="middle" style="padding-left:6px;">${leafSprig({ opacity: 0.5, mirror: true })}</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-bottom:2px;font-family:${FONTS.heading};font-size:22px;font-weight:700;letter-spacing:1.5px;color:${COLORS.text};">
                AN NHIÊN
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-bottom:16px;font-family:${FONTS.body};font-size:11px;font-weight:600;letter-spacing:2px;color:${COLORS.secondary};text-transform:uppercase;">
                Viện Dưỡng Lão
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-bottom:36px;font-family:${FONTS.body};font-size:12px;letter-spacing:0.6px;color:${COLORS.textMuted};text-transform:uppercase;">
                ${escapeHtml(BRAND.tagline)}
              </td>
            </tr>

            <!-- Card -->
            <tr>
              <td style="background-color:${COLORS.surface};border:1px solid ${COLORS.border};border-radius:20px;padding:44px 40px;box-shadow:0 2px 24px rgba(47,58,46,0.06);">
                ${bodyHtml}
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="padding:24px 4px 0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${COLORS.surface};border:1px solid ${COLORS.border};border-radius:16px;">
                  <tr>
                    <td style="padding:22px 26px;">
                      <div style="font-family:${FONTS.heading};font-size:14.5px;font-weight:700;color:${COLORS.text};padding-bottom:12px;">Thông Tin Về Chúng Tôi</div>
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                        ${footerContactRow('mapPin', 'Địa chỉ', escapeHtml(BRAND.address))}
                        ${footerContactRow('phone', 'Hotline', escapeHtml(BRAND.hotline))}
                        ${footerContactRow('mail', 'Email', escapeHtml(BRAND.supportEmail))}
                        ${footerContactRow('clock', 'Giờ hoạt động', escapeHtml(BRAND.hours), true)}
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding-top:18px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${COLORS.text};border-radius:14px;">
                  <tr>
                    <td align="center" style="padding:14px 16px;font-family:${FONTS.body};font-size:11.5px;color:#D8DECF;">
                      © ${new Date().getFullYear()} ${escapeHtml(BRAND.legalName)}. All rights reserved. · Email này được gửi tự động, vui lòng không trả lời.
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;

module.exports = {
  COLORS,
  FONTS,
  ICON_PATHS,
  ICON_COLOR_KEYS,
  ICON_ATTACHMENTS,
  EMAIL_ATTACHMENTS,
  iconSlug,
  BRAND,
  LOGO_ATTACHMENT,
  escapeHtml,
  icon,
  heroIcon,
  rowIcon,
  infoRow,
  otpBoxes,
  codeBlock,
  calloutBox,
  ctaButton,
  pill,
  renderEmailLayout,
};
