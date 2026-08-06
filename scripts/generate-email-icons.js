// One-time build step: rasterizes the Lucide-style icon set used by the
// transactional email templates into small PNG files, one per (icon, color)
// combination actually used. Inline <svg> is stripped by many mail clients
// (confirmed: Gmail renders the colored circle background but drops the SVG
// glyph inside), so icons must ship as real raster images — same as the logo,
// which already renders correctly via CID attachment.
//
// Run manually whenever a new icon/color combo is added to mailService.js:
//   node scripts/generate-email-icons.js
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { ICON_PATHS, ICON_COLOR_KEYS, iconSlug } = require('../utils/emailBrand');

const OUT_DIR = path.join(__dirname, '..', 'assets', 'email', 'icons');
const CANVAS = 96; // rendered high-res; each <img> scales down to its display size
const STROKE_WIDTH = 1.8;

// Every (icon name, color key) pair actually referenced in mailService.js.
const MANIFEST = [
  ['lock', 'primary'],
  ['mailCheck', 'success'],
  ['triangleAlert', 'danger'],
  ['triangleAlert', 'warning'],
  ['userCheck', 'primary'],
  ['shield', 'warning'],
  ['shield', 'primary'],
  ['user', 'primary'],
  ['user', 'warning'],
  ['idCard', 'primary'],
  ['mail', 'primary'],
  ['activity', 'warning'],
  ['users', 'warning'],
  ['checkCircle', 'warning'],
  ['clock', 'warning'],
  ['clock', 'primary'],
  ['mapPin', 'warning'],
  ['mapPin', 'primary'],
  ['messageSquare', 'muted'],
  ['clipboard', 'text'],
  ['phone', 'primary'],
  ['chevronRight', 'white'],
];

const HEX_BY_KEY = Object.fromEntries(Object.entries(ICON_COLOR_KEYS).map(([hex, key]) => [key, hex]));

const buildSvg = (name, hex) =>
  `<svg width="${CANVAS}" height="${CANVAS}" viewBox="0 0 24 24" fill="none" stroke="${hex}" stroke-width="${STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">${ICON_PATHS[name]}</svg>`;

(async () => {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const [name, colorKey] of MANIFEST) {
    const hex = HEX_BY_KEY[colorKey];
    if (!ICON_PATHS[name]) throw new Error(`Unknown icon: ${name}`);
    if (!hex) throw new Error(`Unknown color key: ${colorKey}`);
    const svg = buildSvg(name, hex);
    const outFile = path.join(OUT_DIR, `${iconSlug(name, colorKey)}.png`);
    await sharp(Buffer.from(svg)).png().toFile(outFile);
    console.log('generated', path.basename(outFile));
  }

  console.log(`\n${MANIFEST.length} icons written to ${OUT_DIR}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
