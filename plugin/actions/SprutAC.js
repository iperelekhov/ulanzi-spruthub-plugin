// Air Conditioner action (Sprut.hub Thermostat/HeaterCooler).
//
// One action, many roles (chosen in the Property Inspector):
//   display   - large 2:1 tile showing current/target temp, mode, fan, swing.
//               A press cycles the property named by `cycle` (mode/fan/swing).
//   mode      - press cycles heat -> cool -> auto (-> off if included)
//   fan       - press cycles fan speed 0(auto)..max
//   swing     - press toggles swing on/off
//   temp_up   - press raises target temperature by one step
//   temp_down - press lowers target temperature by one step
//   power     - press toggles the AC on/off (mode off <-> last on-mode)
//
// The AC's characteristic ids are configured once (per key). All roles read the
// same set so the display and controls stay consistent. Credentials come from
// the shared global settings via setGlobalCreds().
//
// Characteristic map (per key settings), all cId numbers on the AC accessory:
//   aId
//   curCId  - CurrentTemperature (read)
//   tgtCId  - TargetTemperature (write)
//   modeCId - TargetHeatingCoolingState (write)  OFF0/HEAT1/COOL2/AUTO3
//   fanCId  - C_FanSpeed (write)                 0=AUTO .. max
//   swingCId- SwingMode (write)                  off=0 on=1 (also -2/-1)
//   sSId    - service id that holds tgt/mode/fan/swing (Thermostat sId)
//   curSId  - service id that holds current temp (may equal sSId)

import { readRaw, sendValue, onCharacteristicChange } from './sprutClient.js';
import { acPairIconUri, glyphLabelUri } from './icons.js';

// Thermostat TargetHeatingCoolingState enum -> glyph / label / color.
// Full range: ECO(-3) DRY(-2) FAN_ONLY(-1) OFF(0) HEAT(1) COOL(2) AUTO(3).
// (HeaterCooler's TargetHeaterCoolerState only uses 0=AUTO/1=HEAT/2=COOL; if a
//  key is pointed at that service, AUTO shows as OFF's slot — configure the
//  Thermostat service, sId 23/cId 26 on the Ballu, for full mode support.)
const MODES = {
  '-3': { key: 'eco', label: 'ECO', color: '#1dd1a1', glyph: 'leaf' },
  '-2': { key: 'dry', label: 'DRY', color: '#54a0ff', glyph: 'droplet' },
  '-1': { key: 'fan_only', label: 'FAN', color: '#8a8a8f', glyph: 'wind' },
  0: { key: 'off', label: 'OFF', color: '#8a8a8f', glyph: 'power' },
  1: { key: 'heat', label: 'HEAT', color: '#ff6b6b', glyph: 'fire' },
  2: { key: 'cool', label: 'COOL', color: '#54a0ff', glyph: 'snowflake' },
  3: { key: 'auto', label: 'AUTO', color: '#1dd1a1', glyph: 'auto' },
};
const MODE_GLYPH = Object.fromEntries(
  Object.entries(MODES).map(([k, v]) => [k, v.glyph])
);
// Cycle order for the mode control. Cover all active modes the AC advertises;
// OFF is reached via the power role, so we skip it here.
const MODE_CYCLE = [1, 2, 3, -1, -2, -3];
const FAN_MAX = 5; // C_FanSpeed max on the hub (0=AUTO..5=TURBO)
const SWING_ON = 1;
const SWING_OFF = 0;

export default function SprutAC(context, $UD) {
  let settings = {}; // ids + role + cycle
  let globalCreds = {};
  let allowSend = true;
  let busy = false;
  let refreshTimer = null;

  // Live values.
  let cur = null, tgt = null, mode = null, fan = null, swing = null;
  let lastOnMode = 2; // remember a non-off mode for power toggle

  function hasCreds() {
    return Boolean(globalCreds.wsUrl && globalCreds.email && globalCreds.password && globalCreds.serial);
  }
  function role() { return settings.role || 'display'; }
  function num(v) { const n = Number(v); return Number.isNaN(n) ? null : n; }
  function ids(sIdKey, cIdKey) {
    const s = settings[sIdKey], c = settings[cIdKey];
    return settings.aId && s && c ? { aId: settings.aId, sId: s, cId: c } : null;
  }
  // Current temperature usually lives on the same service; default curSId to sSId.
  const curIds = () => {
    if (!settings.aId || !settings.curCId) return null;
    const s = settings.curSId || settings.sSId;
    return s ? { aId: settings.aId, sId: s, cId: settings.curCId } : null;
  };
  const tgtIds = () => ids('sSId', 'tgtCId');
  const modeIds = () => ids('sSId', 'modeCId');
  const fanIds = () => ids('sSId', 'fanCId');
  const swingIds = () => ids('sSId', 'swingCId');

  // ---- rendering -----------------------------------------------------------

  function render() {
    if (!allowSend) return;
    const r = role();
    if (r === 'display') return renderDisplay();
    renderControl(r);
  }

  // Build one display row for a given item name.
  function row(name) {
    const m = MODES[mode] || MODES[2];
    const fanAuto = fan === 0 || fan === null;
    switch (name) {
      case 'current':
        return { value: fmtT(cur), unit: '°', color: '#ffffff' };
      case 'target':
        return { glyph: 'auto', value: fmtT(tgt), unit: '°', color: m.color, _noGlyph: true };
      case 'mode':
        return { glyph: MODE_GLYPH[mode] || 'auto', value: m.label, color: m.color };
      case 'fan':
        return { glyph: 'fan', value: fanAuto ? 'AUTO' : 'FAN ' + fan, color: fanAuto ? '#8a8a8f' : '#54a0ff' };
      case 'swing':
        return { glyph: 'swing', value: swing === SWING_ON ? 'SWING' : 'FIXED', color: swing === SWING_ON ? '#1dd1a1' : '#8a8a8f' };
      default:
        return null;
    }
  }

  // displayPair -> the two items to show.
  const PAIRS = {
    temps: ['current', 'target'],
    mode_fan: ['mode', 'fan'],
    target_mode: ['target', 'mode'],
    swing_fan: ['swing', 'fan'],
  };

  function renderDisplay() {
    const pair = PAIRS[settings.displayPair] || PAIRS.temps;
    const rows = pair.map((n) => {
      const r = row(n);
      if (r && r._noGlyph) delete r.glyph; // target shows an arrow prefix instead
      if (r && n === 'target') r.value = '→ ' + r.value;
      return r;
    });
    $UD.setBaseDataIcon(context, acPairIconUri(rows, mode === 0));
  }

  // Small control keys show the property glyph + its current value.
  function renderControl(r) {
    let g, label, color;
    if (r === 'mode') {
      const m = MODES[mode] || MODES[2];
      g = MODE_GLYPH[mode] || 'auto'; label = m.label; color = m.color;
    } else if (r === 'fan') {
      g = 'fan'; label = (fan === 0 || fan === null) ? 'AUTO' : 'FAN ' + fan;
      color = (fan === 0 || fan === null) ? '#8a8a8f' : '#54a0ff';
    } else if (r === 'swing') {
      g = 'swing'; label = swing === SWING_ON ? 'ON' : 'OFF';
      color = swing === SWING_ON ? '#1dd1a1' : '#8a8a8f';
    } else if (r === 'temp_up') {
      g = 'up'; label = tgt === null ? '--' : tgt + '°'; color = '#ff9f43';
    } else if (r === 'temp_down') {
      g = 'down'; label = tgt === null ? '--' : tgt + '°'; color = '#54a0ff';
    } else if (r === 'power') {
      g = 'power'; label = mode === 0 ? 'OFF' : 'ON';
      color = mode === 0 ? '#8a8a8f' : '#1dd1a1';
    } else {
      return;
    }
    $UD.setBaseDataIcon(context, glyphLabelUri(g, label, color));
  }

  // ---- data ----------------------------------------------------------------

  const unsubscribe = onCharacteristicChange((ev) => {
    let changed = false;
    const apply = (idset, setter) => {
      if (idset &&
        Number(ev.aId) === Number(idset.aId) &&
        Number(ev.sId) === Number(idset.sId) &&
        Number(ev.cId) === Number(idset.cId)) {
        setter(num(ev.value && (ev.value.doubleValue ?? ev.value.intValue ?? ev.value.floatValue)));
        changed = true;
      }
    };
    apply(curIds(), (v) => { cur = v; });
    apply(tgtIds(), (v) => { tgt = v; });
    apply(modeIds(), (v) => { mode = v; if (v && v > 0) lastOnMode = v; });
    apply(fanIds(), (v) => { fan = v; });
    apply(swingIds(), (v) => { swing = v; });
    if (changed) render();
  });

  function refresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(doRefresh, 700);
  }

  let refreshing = false;
  async function doRefresh() {
    if (!hasCreds() || refreshing) return;
    refreshing = true;
    try {
      if (curIds()) cur = num(await readRaw(globalCreds, curIds()));
      if (tgtIds()) tgt = num(await readRaw(globalCreds, tgtIds()));
      if (modeIds()) { mode = num(await readRaw(globalCreds, modeIds())); if (mode > 0) lastOnMode = mode; }
      if (fanIds()) fan = num(await readRaw(globalCreds, fanIds()));
      if (swingIds()) swing = num(await readRaw(globalCreds, swingIds()));
      render();
    } catch (e) {
      log('refresh error:', e.message);
    } finally {
      refreshing = false;
    }
  }

  // ---- press actions -------------------------------------------------------

  async function run() {
    if (busy || !hasCreds()) { if (!hasCreds()) $UD.toast('Configure Spruthub credentials first'); return; }
    busy = true;
    try {
      const r = role();
      if (r === 'display') await cycle(settings.cycle || 'mode');
      else if (r === 'mode') await cycle('mode');
      else if (r === 'fan') await cycle('fan');
      else if (r === 'swing') await cycle('swing');
      else if (r === 'temp_up') await stepTemp(+1);
      else if (r === 'temp_down') await stepTemp(-1);
      else if (r === 'power') await togglePower();
    } catch (e) {
      log('run error:', e.message);
      $UD.toast(`Spruthub: ${e.message}`);
    } finally {
      busy = false;
    }
  }

  async function cycle(what) {
    if (what === 'mode' && modeIds()) {
      const i = MODE_CYCLE.indexOf(mode);
      const next = MODE_CYCLE[(i + 1) % MODE_CYCLE.length];
      await sendValue(globalCreds, modeIds(), next);
      mode = next; lastOnMode = next;
    } else if (what === 'fan' && fanIds()) {
      const next = (fan === null ? 0 : (fan + 1)) > FAN_MAX ? 0 : (fan ?? -1) + 1;
      await sendValue(globalCreds, fanIds(), next);
      fan = next;
    } else if (what === 'swing' && swingIds()) {
      const next = swing === SWING_ON ? SWING_OFF : SWING_ON;
      await sendValue(globalCreds, swingIds(), next);
      swing = next;
    }
    render();
  }

  async function stepTemp(dir) {
    if (!tgtIds() || tgt === null) return;
    const step = num(settings.tempStep) || 1;
    const min = num(settings.tempMin) ?? 16;
    const max = num(settings.tempMax) ?? 30;
    let next = tgt + dir * step;
    next = Math.max(min, Math.min(max, next));
    if (next === tgt) return;
    await sendValue(globalCreds, tgtIds(), next);
    tgt = next;
    render();
  }

  async function togglePower() {
    if (!modeIds()) return;
    const next = mode === 0 ? lastOnMode : 0;
    await sendValue(globalCreds, modeIds(), next);
    mode = next;
    render();
  }

  // ---- lifecycle -----------------------------------------------------------

  function updateSettings(s) { settings = s || {}; refresh(); }
  function setGlobalCreds(c) { globalCreds = c || {}; refresh(); }
  function setActive(active) { allowSend = true; render(); allowSend = active; }
  function destroy() { if (refreshTimer) clearTimeout(refreshTimer); unsubscribe(); }

  render();
  return { run, updateSettings, setGlobalCreds, setActive, destroy };
}

function fmtT(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '--';
  const r = Number(n).toFixed(1);
  return r.endsWith('.0') ? r.slice(0, -2) : r;
}

function log(...m) { console.log(`[${new Date().toLocaleString()}] [SprutAC]`, ...m); }
