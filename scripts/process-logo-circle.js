// Crops the tree/house/couple emblem out of the source logo (dropping the
// "AN NHIÊN / VIỆN DƯỠNG LÃO" wordmark, which the email now renders as real
// HTML text instead of baked-in raster) and masks it into a clean circular
// badge with a transparent background — "bo tròn" per the redesign request.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const SOURCE = 'C:/Users/ADMIN/Desktop/do an/Nursing_Home_Mobile_V1/assets/images/logo-annhien.png';
const OUT = path.join(__dirname, '..', 'assets', 'email', 'logo-annhien.png');
const FINAL_SIZE = 320;
const EMBLEM_HEIGHT_RATIO = 0.78; // crop this fraction of the trimmed width as height — emblem only, no text

(async () => {
  const trimmed = await sharp(SOURCE).trim({ background: '#ffffff', threshold: 10 }).toBuffer({ resolveWithObject: true });
  const { data, info } = trimmed;
  const emblemHeight = Math.round(info.width * EMBLEM_HEIGHT_RATIO);

  const emblem = await sharp(data)
    .extract({ left: 0, top: 0, width: info.width, height: emblemHeight })
    .toBuffer();

  // Pad to a square canvas (transparent), centering the emblem vertically,
  // so the circular mask below doesn't clip the tree top or the swoosh tail.
  const square = info.width;
  const padTop = Math.round((square - emblemHeight) / 2);
  // Extend then resize in separate pipelines — sharp mis-sizes the output
  // when both are chained on one instance without materializing a buffer
  // in between (reproduced: chained gives 320x485, split gives 320x320).
  const paddedSquare = await sharp(emblem)
    .ensureAlpha()
    .extend({
      top: padTop,
      bottom: square - emblemHeight - padTop,
      left: 0,
      right: 0,
      background: { r: 255, g: 255, b: 255, alpha: 0 },
    })
    .toBuffer();
  const padded = await sharp(paddedSquare).resize(FINAL_SIZE, FINAL_SIZE).toBuffer();

  const circleMask = Buffer.from(
    `<svg width="${FINAL_SIZE}" height="${FINAL_SIZE}"><circle cx="${FINAL_SIZE / 2}" cy="${FINAL_SIZE / 2}" r="${FINAL_SIZE / 2}" fill="#fff"/></svg>`
  );

  await sharp(padded)
    .composite([{ input: circleMask, blend: 'dest-in' }])
    .png()
    .toFile(OUT);

  console.log('Circular logo badge written to', OUT);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
