// Button (press) action.
//
// Emits a press to a Spruthub characteristic by writing an integer value —
// e.g. a ProgrammableSwitchEvent: 0 = single, 1 = double, 2 = long press.
// This is fire-and-forget: the characteristic is stateless, so the key has no
// on/off state; it just flashes on press.
//
// Per-key settings: { aId, sId, cId, pressValue }. Credentials are the shared
// plugin-wide global settings injected via setGlobalCreds().
//
// Same factory shape as the other actions:
// { run, updateSettings, setGlobalCreds, setActive, destroy }.

import { sendValue } from './sprutClient.js';
import { setFileIcon } from './icons.js';

export default function SprutButton(context, $UD) {
  let settings = {}; // { aId, sId, cId, pressValue }
  let globalCreds = {};
  let allowSend = true;
  let busy = false;

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

  // Reset to the default (idle) button icon.
  function renderIdle() {
    if (!allowSend) return;
    setFileIcon($UD, context, 'assets/icons/button.svg');
  }

  function showError() {
    if (!allowSend) return;
    setFileIcon($UD, context, 'assets/actions/fail.png');
  }

  function flashSuccess() {
    if (!allowSend) return;
    // Brief press feedback, then back to idle.
    setFileIcon($UD, context, 'assets/actions/success.png');
    setTimeout(renderIdle, 600);
  }

  async function run() {
    if (busy) return;
    if (!hasCreds()) {
      $UD.toast('Configure Spruthub credentials first');
      showError();
      return;
    }
    if (!hasIds()) {
      $UD.toast('Configure aId/sId/cId first');
      showError();
      return;
    }

    // pressValue is an integer (0=single, 1=double, 2=long); default single.
    const value = Number.parseInt(settings.pressValue, 10);
    const pressValue = Number.isNaN(value) ? 0 : value;

    busy = true;
    try {
      await sendValue(globalCreds, settings, pressValue);
      flashSuccess();
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
    renderIdle();
  }

  function setGlobalCreds(creds) {
    globalCreds = creds || {};
  }

  function setActive(active) {
    allowSend = true;
    renderIdle();
    allowSend = active;
  }

  function destroy() {
    // Stateless; nothing to clean up.
  }

  renderIdle();

  return {
    run,
    updateSettings,
    setGlobalCreds,
    setActive,
    destroy,
  };
}

function log(...msg) {
  console.log(`[${new Date().toLocaleString()}] [SprutButton]`, ...msg);
}
