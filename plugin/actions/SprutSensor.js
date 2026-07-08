// Sensor (display) action.
//
// Shows a temperature and/or humidity reading large on the key and keeps it in
// sync live via the hub's WebSocket push events. Read-only — pressing the key
// just forces a refresh.
//
// Per-key settings (all optional, but at least one pair required):
//   temp:     { tAId, tSId, tCId }   -> TemperatureSensor / CurrentTemperature
//   humidity: { hAId, hSId, hCId }   -> HumiditySensor / CurrentRelativeHumidity
// Configure one for a single-value key, or both for a combined key.
//
// Credentials are the shared plugin-wide global settings via setGlobalCreds().

import { readRaw, onCharacteristicChange } from './sprutClient.js';
import { valueIconUri } from './icons.js';

const TEMP_COLOR = '#ff9f43';
const HUMID_COLOR = '#54a0ff';
const PPM_COLOR = '#1dd1a1';

export default function SprutSensor(context, $UD) {
  let settings = {}; // { tAId,tSId,tCId, hAId,hSId,hCId, pAId,pSId,pCId }
  let globalCreds = {};
  let allowSend = true;
  let refreshTimer = null;
  let tempVal = null; // number | null
  let humidVal = null; // number | null
  let ppmVal = null; // number | null

  function hasCreds() {
    return Boolean(
      globalCreds.wsUrl &&
        globalCreds.email &&
        globalCreds.password &&
        globalCreds.serial
    );
  }

  function tempIds() {
    return settings.tAId && settings.tSId && settings.tCId
      ? { aId: settings.tAId, sId: settings.tSId, cId: settings.tCId }
      : null;
  }

  function humidIds() {
    return settings.hAId && settings.hSId && settings.hCId
      ? { aId: settings.hAId, sId: settings.hSId, cId: settings.hCId }
      : null;
  }

  function ppmIds() {
    return settings.pAId && settings.pSId && settings.pCId
      ? { aId: settings.pAId, sId: settings.pSId, cId: settings.pCId }
      : null;
  }

  function fmt(n, digits = 1) {
    if (n === null || n === undefined || Number.isNaN(Number(n))) return '--';
    // Trim trailing .0 for whole numbers.
    const r = Number(n).toFixed(digits);
    return r.endsWith('.0') ? r.slice(0, -2) : r;
  }

  function render() {
    if (!allowSend) return;
    const rows = [];
    if (tempIds()) rows.push({ value: fmt(tempVal), unit: '°', color: TEMP_COLOR });
    if (humidIds()) rows.push({ value: fmt(humidVal, 0), unit: '%', color: HUMID_COLOR });
    if (ppmIds()) rows.push({ value: fmt(ppmVal, 0), unit: 'ppm', color: PPM_COLOR });
    if (rows.length === 0) return; // nothing configured yet
    $UD.setBaseDataIcon(context, valueIconUri(rows));
  }

  // Match a live push against our configured characteristics.
  function matches(ids, ev) {
    return (
      ids &&
      Number(ev.aId) === Number(ids.aId) &&
      Number(ev.sId) === Number(ids.sId) &&
      Number(ev.cId) === Number(ids.cId)
    );
  }

  const unsubscribe = onCharacteristicChange((ev) => {
    let changed = false;
    const num = toNum(ev.value);
    if (num !== null && matches(tempIds(), ev) && num !== tempVal) {
      tempVal = num;
      changed = true;
    }
    if (num !== null && matches(humidIds(), ev) && num !== humidVal) {
      humidVal = num;
      changed = true;
    }
    if (num !== null && matches(ppmIds(), ev) && num !== ppmVal) {
      ppmVal = num;
      changed = true;
    }
    if (changed) render();
  });

  // Debounced initial read (settings/creds arrive keystroke-by-keystroke).
  function refresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(doRefresh, 700);
  }

  async function doRefresh() {
    if (!hasCreds()) return;
    try {
      const t = tempIds();
      const h = humidIds();
      const p = ppmIds();
      if (t) tempVal = toNum(await readRaw(globalCreds, t));
      if (h) humidVal = toNum(await readRaw(globalCreds, h));
      if (p) ppmVal = toNum(await readRaw(globalCreds, p));
      render();
    } catch (e) {
      log('refresh error:', e.message);
    }
  }

  // Pressing a sensor key just re-reads (handy if a push was missed).
  function run() {
    doRefresh();
  }

  function updateSettings(new_settings) {
    settings = new_settings || {};
    refresh();
  }

  function setGlobalCreds(creds) {
    globalCreds = creds || {};
    refresh();
  }

  function setActive(active) {
    allowSend = true;
    render();
    allowSend = active;
  }

  function destroy() {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
    unsubscribe();
  }

  render();

  return {
    run,
    updateSettings,
    setGlobalCreds,
    setActive,
    destroy,
  };
}

function toNum(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function log(...msg) {
  console.log(`[${new Date().toLocaleString()}] [SprutSensor]`, ...msg);
}
