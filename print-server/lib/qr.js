/**
 * QR helper — synchronous, so `HtmlRenderer.renderForPrint()` can stay synchronous
 * (job-processor and the P1-print spec both call it and use the return value directly,
 * no await). `qrcode`'s own `toDataURL()` is callback/Promise-based even though the
 * encode itself is pure CPU work, so we do the same encode with `QRCode.create()`
 * (synchronous) and draw the modules into a small SVG ourselves.
 */

const QRCode = require('qrcode');

/**
 * @param {string} text
 * @param {number} size  pixel size of the (square) output
 * @returns {string} a `data:image/svg+xml;base64,...` URL
 */
function qrSvgDataUrl(text, size = 132) {
  const qr = QRCode.create(String(text ?? ''), { errorCorrectionLevel: 'M' });
  const modules = qr.modules;
  const n = modules.size;
  const margin = 2; // quiet zone, in modules
  const cell = size / (n + margin * 2);

  let rects = '';
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (!modules.get(row, col)) continue;
      const x = (col + margin) * cell;
      const y = (row + margin) * cell;
      rects += `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}"/>`;
    }
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">` +
    `<rect width="${size}" height="${size}" fill="#fff"/>` +
    `<g fill="#000">${rects}</g>` +
    `</svg>`;

  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

module.exports = { qrSvgDataUrl };
