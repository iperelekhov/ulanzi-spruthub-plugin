// Bulb Toggle action.
//
// Each key instance holds its own device IDs (aId/sId/cId) via per-key
// settings, while the Spruthub credentials are shared plugin-wide (global
// settings) and injected by app.js through setGlobalCreds().
//
// Mirrors the factory-function shape of the APIRequest demo's action:
// returns { run, updateSettings, setGlobalCreds, setActive, destroy }.

import { setValue, readValue, onCharacteristicChange } from './sprutClient.js';
import { setFileIcon } from './icons.js';

// Coerce a Sprut control value object (e.g. { boolValue: true }) to a bool.
function toBool(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') {
    if ('boolValue' in value) return Boolean(value.boolValue);
    if ('intValue' in value) return Boolean(value.intValue);
    return null;
  }
  if (typeof value === 'boolean') return value;
  return !(['false', '0', '', 'off'].indexOf(String(value).toLowerCase().trim()) + 1);
}

// manifest.json States: index 0 = off icon, index 1 = on icon.
const STATE_OFF = 0;
const STATE_ON = 1;

export default function SprutToggle(context, $UD) {
  let settings = {}; // { aId, sId, cId }
  let globalCreds = {}; // { wsUrl, email, password, serial }
  let key_state = null; // true=on, false=off, null=unknown
  let allowSend = true;
  let busy = false;
  let refreshTimer = null;

  // Live updates: react to characteristic pushes from the hub (state changed
  // in the Spruthub app, another key, an automation, etc.) so the icon stays
  // in sync without polling.
  const unsubscribe = onCharacteristicChange(({ aId, sId, cId, value }) => {
    if (!hasIds()) return;
    if (
      Number(aId) === Number(settings.aId) &&
      Number(sId) === Number(settings.sId) &&
      Number(cId) === Number(settings.cId)
    ) {
      const b = toBool(value);
      if (b !== null && b !== key_state) {
        key_state = b;
        renderState();
      }
    }
  });

  function hasIds() {
    return Boolean(settings.aId && settings.sId && settings.cId);
  }

  function hasCreds() {
    return Boolean(
      globalCreds.wsUrl &&
        globalCreds.email &&
        globalCreds.password &&
        globalCreds.serial
    );
  }

  // Reflect current on/off state on the key using the manifest state icons.
  function renderState() {
    if (!allowSend) return;
    const state = key_state ? STATE_ON : STATE_OFF;
    $UD.setStateIcon(context, state);
  }

  function showError() {
    if (!allowSend) return;
    setFileIcon($UD, context, 'assets/actions/fail.png');
  }

  // Debounced state refresh. Settings/creds arrive keystroke-by-keystroke from
  // the Property Inspector, so we wait for input to settle before attempting a
  // connection — otherwise we'd try to authenticate with a half-typed email
  // (which the hub rejects with "Expected password question type").
  function refreshState() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(doRefreshState, 700);
  }

  // Read the live value from the hub to seed the icon (best-effort).
  async function doRefreshState() {
    if (!hasIds() || !hasCreds()) return;
    try {
      const value = await readValue(globalCreds, settings);
      if (value !== null) {
        key_state = value;
        renderState();
      }
    } catch (e) {
      log('refreshState error:', e.message);
    }
  }

  // Called on key press: flip the bulb and reflect the new state.
  async function run() {
    if (busy) return;
    if (!hasCreds()) {
      log('No Spruthub credentials configured');
      $UD.toast('Configure Spruthub credentials first');
      showError();
      return;
    }
    if (!hasIds()) {
      log('No device IDs configured');
      $UD.toast('Configure aId/sId/cId first');
      showError();
      return;
    }

    // Unknown state → default to turning on.
    const next = key_state === null ? true : !key_state;
    busy = true;
    try {
      await setValue(globalCreds, settings, next);
      key_state = next;
      renderState();
    } catch (e) {
      log('run error:', e.message);
      $UD.toast(`Spruthub: ${e.message}`);
      showError();
    } finally {
      busy = false;
    }
  }

  function updateSettings(new_settings) {
    settings = new_settings || {};
    // Device IDs may have changed — re-seed from the hub.
    refreshState();
  }

  function setGlobalCreds(creds) {
    globalCreds = creds || {};
    refreshState();
  }

  function setActive(active) {
    allowSend = true;
    renderState();
    allowSend = active;
  }

  function destroy() {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
    unsubscribe();
    // The shared Spruthub client stays open for other keys.
  }

  // Start with the off icon until we learn the real state.
  renderState();

  return {
    run,
    updateSettings,
    setGlobalCreds,
    setActive,
    destroy,
  };
}

function log(...msg) {
  console.log(`[${new Date().toLocaleString()}] [SprutToggle]`, ...msg);
}
