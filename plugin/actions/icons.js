// Icon helpers.
//
// Sending icons as base64 data (setBaseDataIcon / type:1) instead of file
// paths (setPathIcon / type:2) avoids two fragilities:
//   1. The simulator's path resolver mishandles leading-slash plugin paths,
//      leaving the key blank.
//   2. setStateIcon depends on the host having finished registering the key's
//      action states, which isn't guaranteed at construction time.
// Reading the file and embedding it is robust in both the simulator and the
// real app.

import fs from 'fs';
import { Utils } from './ulanzi-api/index.js';

const cache = new Map();

function mimeFor(path) {
  if (path.endsWith('.svg')) return 'image/svg+xml';
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.gif')) return 'image/gif';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
}

// pluginPath is relative to the plugin root, e.g. 'assets/icons/button.svg'.
// Returns a data: URI string, or null if the file can't be read.
function dataUri(pluginPath) {
  if (cache.has(pluginPath)) return cache.get(pluginPath);
  try {
    const full = `${Utils.getPluginPath()}/${pluginPath}`;
    const buf = fs.readFileSync(full);
    const uri = `data:${mimeFor(pluginPath)};base64,${buf.toString('base64')}`;
    cache.set(pluginPath, uri);
    return uri;
  } catch (e) {
    return null;
  }
}

// Set a key's icon from a plugin-relative file path, embedded as base64.
function setFileIcon($UD, context, pluginPath) {
  const uri = dataUri(pluginPath);
  if (uri) $UD.setBaseDataIcon(context, uri);
}

// Build an inline SVG data URI showing sensor value(s) large on the key.
// `rows` is an array of { value, unit, color } (1 or 2 rows). SVG text uses a
// system sans-serif font, so no font files need to ship.
function valueIconUri(rows) {
  const SIZE = 200;
  const bg = '#1c1c1e';
  const list = rows.filter(Boolean).slice(0, 3);

  // Per row-count: baseline y positions and font sizes that keep the stack
  // vertically centered and readable.
  const LAYOUT = {
    1: { ys: [118], fs: 72, us: 40 },
    2: { ys: [86, 156], fs: 56, us: 32 },
    3: { ys: [66, 118, 170], fs: 42, us: 24 },
  };
  const { ys, fs, us } = LAYOUT[list.length] || LAYOUT[3];

  let body = '';
  list.forEach((r, i) => {
    body +=
      `<text x="100" y="${ys[i]}" font-family="Helvetica,Arial,sans-serif" ` +
      `font-size="${fs}" font-weight="700" fill="${r.color}" text-anchor="middle">` +
      `${escapeXml(r.value)}<tspan font-size="${us}">${escapeXml(r.unit)}</tspan></text>`;
  });

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">` +
    `<rect width="${SIZE}" height="${SIZE}" fill="${bg}"/>${body}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c])
  );
}

// Font Awesome (solid) glyph paths, viewBox as noted. Free, CC-BY 4.0.
const GLYPHS = {
  // fire — heat mode
  fire: { vb: 448, d: 'M159.3 5.4c7.8-7.3 19.9-7.2 27.7 .1c27.6 25.9 53.5 53.8 77.7 84c11-14.4 23.5-30.1 37-42.9c7.9-7.5 20.4-7.5 28.4 0c37.4 34.9 70.2 78.4 92.4 124.3c19.2 39.8 30.5 82.6 30.5 116.1c0 96.9-79 175.9-176 175.9c-.6 0-1.1 0-1.7 0c-.5 0-1.1 0-1.6 0c-96.9 0-176-79-176-175.9c0-40.4 14.9-84.9 38.7-125.6c24-40.9 57.4-79.2 94.4-113.4l0 0c-.3 .3-.7 .5-1 .8c-.8-.7-1.4-1.5-1.9-2.4c-1.3-2.4-1.3-5.3 0-7.7l0 0zm94.9 219.6c-14.4 32.6-42.5 61.9-42.5 100c0 30.9 25.1 56 56 56s56-25.1 56-56c0-32-18.5-56.9-45.4-77.3c-3.6-2.7-8.9-1.6-11.1 2.4l-1.4 2.6c-.9 1.6-2.8 2.3-4.5 1.6c-1.5-.6-2.4-2.2-2.1-3.8l3.1-15.3c.7-3.3-3.1-5.9-6.1-4.2c-1.1 .6-2 1.6-2.4 2.8l0 0z' },
  // snowflake — cool mode
  snowflake: { vb: 448, d: 'M224 0c17.7 0 32 14.3 32 32l0 30.1 15-15c9.4-9.4 24.6-9.4 33.9 0s9.4 24.6 0 33.9L256 130.1l0 61.7 53.5-30.9 19.6-73.3c3.4-12.8 16.6-20.4 29.4-17s20.4 16.6 17 29.4l-5.5 20.5 26.1-15c15.3-8.8 34.9-3.6 43.7 11.7s3.6 34.9-11.7 43.7l-26.1 15 20.5 5.5c12.8 3.4 20.4 16.6 17 29.4s-16.6 20.4-29.4 17l-73.3-19.6L307 256l53.5 30.9 73.3-19.6c12.8-3.4 26 4.2 29.4 17s-4.2 26-17 29.4l-20.5 5.5 26.1 15c15.3 8.8 20.5 28.4 11.7 43.7s-28.4 20.5-43.7 11.7l-26.1-15 5.5 20.5c3.4 12.8-4.2 26-17 29.4s-26-4.2-29.4-17l-19.6-73.3L256 321.9l0 61.7 48.8 48.8c9.4 9.4 9.4 24.6 0 33.9s-24.6 9.4-33.9 0l-15-15 0 30.1c0 17.7-14.3 32-32 32s-32-14.3-32-32l0-30.1-15 15c-9.4 9.4-24.6 9.4-33.9 0s-9.4-24.6 0-33.9L192 383.6l0-61.7-53.5 30.9-19.6 73.3c-3.4 12.8-16.6 20.4-29.4 17s-20.4-16.6-17-29.4l5.5-20.5-26.1 15c-15.3 8.8-34.9 3.6-43.7-11.7s-3.6-34.9 11.7-43.7l26.1-15-20.5-5.5c-12.8-3.4-20.4-16.6-17-29.4s16.6-20.4 29.4-17l73.3 19.6L141 256 87.5 225.1 14.2 244.7c-12.8 3.4-26-4.2-29.4-17l0 0c-3.4-12.8 4.2-26 17-29.4l20.5-5.5-26.1-15C-19.2 169-24.4 149.4-15.6 134.1S12.8 113.6 28.1 122.4l26.1 15L48.7 116.9c-3.4-12.8 4.2-26 17-29.4s26 4.2 29.4 17l19.6 73.3L168 208.1l0-61.7L119.2 97.6c-9.4-9.4-9.4-24.6 0-33.9s24.6-9.4 33.9 0l15 15L168 32c0-17.7 14.3-32 32-32l24 0z' },
  // arrows-rotate — auto mode
  auto: { vb: 512, d: 'M105.1 202.6c7.7-21.8 20.2-42.3 37.8-59.8c62.5-62.5 163.8-62.5 226.3 0L386.3 160 352 160c-17.7 0-32 14.3-32 32s14.3 32 32 32l111.5 0c0 0 0 0 0 0l.4 0c17.7 0 32-14.3 32-32l0-112c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 35.2L414.4 97.6c-87.5-87.5-229.3-87.5-316.8 0C73.2 122 55.6 150.7 44.8 181.4c-5.9 16.7 2.9 34.9 19.5 40.8s34.9-2.9 40.8-19.5zM39 289.3c-5 1.5-9.8 4.2-13.7 8.2c-4 4-6.7 8.8-8.1 14c-.3 1.2-.6 2.5-.8 3.8c-.3 1.7-.4 3.4-.4 5.1L16 432c0 17.7 14.3 32 32 32s32-14.3 32-32l0-35.1 17.6 17.5c0 0 0 0 0 0c87.5 87.4 229.3 87.4 316.7 0c24.4-24.4 42.1-53.1 52.9-83.7c5.9-16.7-2.9-34.9-19.5-40.8s-34.9 2.9-40.8 19.5c-7.7 21.8-20.2 42.3-37.8 59.8c-62.5 62.5-163.8 62.5-226.3 0l-.1-.1L109.6 320l34.4 0c17.7 0 32-14.3 32-32s-14.3-32-32-32L32.5 256c-1.6 0-3.2 .1-4.7 .3l11.2 33z' },
  // power-off
  power: { vb: 512, d: 'M288 32c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 224c0 17.7 14.3 32 32 32s32-14.3 32-32l0-224zM143.5 120.6c13.6-11.3 15.4-31.5 4.1-45.1s-31.5-15.4-45.1-4.1C49.7 115.4 16 181.8 16 256c0 132.5 107.5 240 240 240s240-107.5 240-240c0-74.2-33.8-140.6-86.6-184.6c-13.6-11.3-33.8-9.4-45.1 4.1s-9.4 33.8 4.1 45.1c38.9 32.3 63.5 81 63.5 135.4c0 97.2-78.8 176-176 176s-176-78.8-176-176c0-54.4 24.7-103.1 63.5-135.4z' },
  // fan
  fan: { vb: 512, d: 'M258.6 0c-1.7 0-3.4 .1-5.1 .5C168 17 115.6 102.3 130.5 189.3c2.9 17 8.4 32.9 15.9 47.4L74.7 74.7c-11.8-11.8-31-11.8-42.8 0C-8.2 115.8-8.2 179.9 32 220.1l71.3 71.3c-14.5-7.5-30.4-13-47.4-15.9C-31.1 260.6-116.4 313-133 398.5c-1.6 8.6 1.1 17.5 7.3 23.7c39.4 39.4 108.7 24.9 153.7-20.1l25.4-25.4c-2.9 8.7-4.4 18-4.4 27.6c0 48.6 39.4 88 88 88c8.7 0 17.1-1.3 25-3.6l0 0c85.5-16.6 137.9-101.9 123-188.9c-2.9-17-8.4-32.9-15.9-47.4l71.6 71.6c11.8 11.8 31 11.8 42.8 0c40.2-40.2 40.2-104.3 0-144.5l-71.3-71.3c14.5 7.5 30.4 13 47.4 15.9c87 14.9 172.3-37.6 188.9-123c1.6-8.6-1.1-17.5-7.3-23.7C513 5.3 443.7 19.8 398.7 64.8l-25.4 25.4c2.9-8.7 4.4-18 4.4-27.6c0-48.6-39.4-88-88-88c-8.7 0-17.1 1.3-25 3.6L256 0l2.6 0zM256 224a32 32 0 1 1 0-64 32 32 0 1 1 0 64z' },
  // repeat — swing
  swing: { vb: 512, d: 'M0 224c0 17.7 14.3 32 32 32s32-14.3 32-32c0-53 43-96 96-96l160 0 0 32c0 12.9 7.8 24.6 19.8 29.6s25.7 2.2 34.9-6.9l64-64c12.5-12.5 12.5-32.8 0-45.3l-64-64c-9.2-9.2-22.9-11.9-34.9-6.9S320 19.1 320 32l0 32L160 64C71.6 64 0 135.6 0 224zm512 64c0-17.7-14.3-32-32-32s-32 14.3-32 32c0 53-43 96-96 96l-160 0 0-32c0-12.9-7.8-24.6-19.8-29.6s-25.7-2.2-34.9 6.9l-64 64c-12.5 12.5-12.5 32.8 0 45.3l64 64c9.2 9.2 22.9 11.9 34.9 6.9s19.8-16.6 19.8-29.6l0-32 160 0c88.4 0 160-71.6 160-160z' },
  // temperature-arrow-up
  tempUp: { vb: 512, d: 'M416 0c-17.7 0-32 14.3-32 32l0 214.7c-19.1 11.1-32 31.7-32 55.3c0 35.3 28.7 64 64 64s64-28.7 64-64c0-23.6-12.9-44.2-32-55.3L448 32c0-17.7-14.3-32-32-32zM96 96c-53 0-96 43-96 96l0 128c0 53 43 96 96 96s96-43 96-96l0-128c0-53-43-96-96-96zM320 128l64 0c8.8 0 16-7.2 16-16s-7.2-16-16-16l-64 0c-8.8 0-16 7.2-16 16s7.2 16 16 16zm0 64l64 0c8.8 0 16-7.2 16-16s-7.2-16-16-16l-64 0c-8.8 0-16 7.2-16 16s7.2 16 16 16z' },
  // leaf — eco mode
  leaf: { vb: 512, d: 'M272 96c-78.6 0-145.1 51.5-167.7 122.5c33.6-17 71.5-26.5 111.7-26.5l88 0c8.8 0 16 7.2 16 16s-7.2 16-16 16l-16 0-88 0c-.5 0-1.1 0-1.6 0C132.6 243.5 65.5 315 64.1 402.5c-25.6-46.3-40-99.5-40-156.4C24.1 128.9 129 24 258.2 24C332.2 24 400.9 61.4 441 121.9c-6.8-1.3-13.8-1.9-21-1.9l-148 0-.1 .1zM512 240c0 132.5-107.5 240-240 240c-19.7 0-38.8-2.4-57.1-6.8C332.5 462.7 424 367.8 424 251.4c0-3.8-.1-7.6-.3-11.4L512 240z' },
  // droplet — dry mode
  droplet: { vb: 384, d: 'M192 512C86 512 0 426 0 320C0 228.8 130.2 57.7 166.6 11.7C172.6 4.2 181.5 0 191 0l1.9 0c9.6 0 18.5 4.2 24.5 11.7C253.8 57.7 384 228.8 384 320c0 106-86 192-192 192zM96 336c0-8.8-7.2-16-16-16s-16 7.2-16 16c0 61.9 50.1 112 112 112c8.8 0 16-7.2 16-16s-7.2-16-16-16c-44.2 0-80-35.8-80-80z' },
  // wind — fan-only mode
  wind: { vb: 512, d: 'M288 32c0 17.7 14.3 32 32 32l32 0c17.7 0 32 14.3 32 32s-14.3 32-32 32L32 128c-17.7 0-32 14.3-32 32s14.3 32 32 32l320 0c53 0 96-43 96-96s-43-96-96-96L320 0c-17.7 0-32 14.3-32 32zm64 352c0 17.7 14.3 32 32 32l32 0c53 0 96-43 96-96s-43-96-96-96L32 224c-17.7 0-32 14.3-32 32s14.3 32 32 32l384 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-32 0c-17.7 0-32 14.3-32 32zM128 512l32 0c53 0 96-43 96-96s-43-96-96-96L32 320c-17.7 0-32 14.3-32 32s14.3 32 32 32l128 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-32 0c-17.7 0-32 14.3-32 32s14.3 32 32 32z' },
  // chevron-up
  up: { vb: 512, d: 'M233.4 105.4c12.5-12.5 32.8-12.5 45.3 0l192 192c12.5 12.5 12.5 32.8 0 45.3s-32.8 12.5-45.3 0L256 173.3 86.6 342.6c-12.5 12.5-32.8 12.5-45.3 0s-12.5-32.8 0-45.3l192-192z' },
  // chevron-down
  down: { vb: 512, d: 'M233.4 406.6c12.5 12.5 32.8 12.5 45.3 0l192-192c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L256 338.7 86.6 169.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l192 192z' },
};

function glyph(name, x, y, size, color) {
  const g = GLYPHS[name];
  if (!g) return '';
  const s = size / g.vb;
  return `<g transform="translate(${x},${y}) scale(${s})" fill="${color}"><path d="${g.d}"/></g>`;
}

// Square air-conditioner tile for a normal keypad key. `state`:
//   { current, target, mode, modeColor, fanLevel, fanIsAuto, swingOn, powerOn }
// Layout (200x200): current temp big on top, a compact mode/fan/swing icon row
// in the middle, and the target temp on the bottom.
function acIconUri(state) {
  const W = 200, H = 200, bg = '#1c1c1e';
  const s = state || {};
  const dim = s.powerOn === false ? 0.4 : 1; // dim everything when off

  const modeGlyph = { heat: 'fire', cool: 'snowflake', auto: 'auto', off: 'power' }[s.mode] || 'auto';
  const modeColor = s.modeColor || '#ff9f43';
  const fanColor = s.fanIsAuto ? '#8a8a8f' : '#54a0ff';
  const swingColor = s.swingOn ? '#1dd1a1' : '#55555a';

  let body = `<rect width="${W}" height="${H}" fill="${bg}"/>`;
  body += `<g opacity="${dim}">`;

  // Current temperature — big, top.
  body +=
    `<text x="100" y="78" font-family="Helvetica,Arial,sans-serif" font-size="76" ` +
    `font-weight="700" fill="#ffffff" text-anchor="middle">${escapeXml(fmtT(s.current))}` +
    `<tspan font-size="34">°</tspan></text>`;

  // Middle icon row: mode | fan | swing (each ~40px).
  body += glyph(modeGlyph, 14, 104, 40, modeColor);
  body += glyph('fan', 80, 104, 40, fanColor);
  body += glyph('swing', 146, 104, 40, swingColor);
  // Fan level number under the fan glyph (AUTO shown as A).
  body +=
    `<text x="100" y="152" font-family="Helvetica,Arial,sans-serif" font-size="18" ` +
    `font-weight="700" fill="${fanColor}" text-anchor="middle">${escapeXml(s.fanIsAuto ? 'A' : String(s.fanLevel))}</text>`;

  // Target temperature — bottom.
  body +=
    `<text x="100" y="190" font-family="Helvetica,Arial,sans-serif" font-size="34" ` +
    `font-weight="600" fill="${modeColor}" text-anchor="middle">→ ${escapeXml(fmtT(s.target))}` +
    `<tspan font-size="20">°</tspan></text>`;

  body += `</g>`;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function fmtT(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '--';
  const r = Number(n).toFixed(1);
  return r.endsWith('.0') ? r.slice(0, -2) : r;
}

// A square control-key tile: a glyph on top and a value label below.
// `glyphName` is one of GLYPHS; `label` is short text; `color` tints both.
function glyphLabelUri(glyphName, label, color) {
  const SIZE = 200, bg = '#1c1c1e';
  const g = glyph(glyphName, 62, 26, 76, color); // centered-ish, 76px
  const body =
    `<rect width="${SIZE}" height="${SIZE}" fill="${bg}"/>${g}` +
    `<text x="100" y="176" font-family="Helvetica,Arial,sans-serif" font-size="40" ` +
    `font-weight="700" fill="${color}" text-anchor="middle">${escapeXml(label)}</text>`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">${body}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

// A square 2-row AC display tile. Each of the (up to 2) rows is:
//   { glyph?, value, unit?, color }
// The row is drawn as: [optional glyph]  value[unit], vertically split so both
// rows are large and readable on one key. `dim` fades the whole tile (AC off).
function acPairIconUri(rows, dim) {
  const SIZE = 200, bg = '#1c1c1e';
  const list = (rows || []).filter(Boolean).slice(0, 2);
  const ys = [76, 166];      // text baselines
  const gy = [26, 116];      // glyph tops

  let body = `<rect width="${SIZE}" height="${SIZE}" fill="${bg}"/>`;
  body += `<g opacity="${dim ? 0.4 : 1}">`;
  list.forEach((r, i) => {
    const hasG = Boolean(r.glyph);
    // With a glyph, use a smaller font and left-anchor the text beside it so
    // longer labels (COOL / FAN 3 / SWING) never clip.
    const fs = hasG ? 40 : 60;
    const us = hasG ? 24 : 32;
    const gsz = 44;
    const gx = 16;
    const tx = hasG ? 74 : 100;
    const anchor = hasG ? 'start' : 'middle';
    if (hasG) body += glyph(r.glyph, gx, gy[i], gsz, r.color);
    body +=
      `<text x="${tx}" y="${ys[i]}" font-family="Helvetica,Arial,sans-serif" ` +
      `font-size="${fs}" font-weight="700" fill="${r.color}" text-anchor="${anchor}">` +
      `${escapeXml(r.value)}<tspan font-size="${us}">${escapeXml(r.unit || '')}</tspan></text>`;
  });
  body += `</g>`;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">${body}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

export { dataUri, setFileIcon, valueIconUri, acIconUri, acPairIconUri, glyph, glyphLabelUri, GLYPHS };
