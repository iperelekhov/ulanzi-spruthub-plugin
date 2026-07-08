import { UlanziApi } from './actions/ulanzi-api/index.js';

import SprutToggle from './actions/SprutToggle.js';
import SprutButton from './actions/SprutButton.js';
import SprutSensor from './actions/SprutSensor.js';
import SprutAC from './actions/SprutAC.js';

// Pick the action implementation from the action UUID's last segment.
// The socket action is functionally identical to the bulb toggle (an On/Off
// boolean characteristic) — it just uses socket icons from its manifest states.
function createInstance(uuid, context) {
  if (uuid && uuid.endsWith('.button')) return new SprutButton(context, $UD);
  if (uuid && uuid.endsWith('.sensor')) return new SprutSensor(context, $UD);
  if (uuid && uuid.endsWith('.ac')) return new SprutAC(context, $UD);
  return new SprutToggle(context, $UD); // .toggle and .socket
}

const ACTION_CACHES = {};

// Plugin-wide Spruthub credentials (wsUrl/email/password/serial), shared by all
// keys and persisted via UlanziStudio global settings.
let GLOBAL_CREDS = {};

const CRED_KEYS = ['wsUrl', 'email', 'password', 'serial'];

const $UD = new UlanziApi();

$UD.connect('com.ulanzi.ulanzistudio.spruthub');

$UD.onConnected(() => {
  // Ask the host for any previously saved global credentials.
  $UD.getGlobalSettings();
});

// Extract the credential subset from an arbitrary settings blob.
function pickCreds(obj) {
  const creds = {};
  if (obj) {
    for (const k of CRED_KEYS) {
      if (obj[k] !== undefined) creds[k] = obj[k];
    }
  }
  return creds;
}

// Push the current credentials into every active key instance.
function broadcastCreds() {
  for (const context of Object.keys(ACTION_CACHES)) {
    ACTION_CACHES[context].setGlobalCreds(GLOBAL_CREDS);
  }
}

// 把插件某个功能配置到按键上
$UD.onAdd((jsn) => {
  const context = jsn.context;
  if (!ACTION_CACHES[context]) {
    ACTION_CACHES[context] = createInstance(jsn.uuid, context);
    ACTION_CACHES[context].setGlobalCreds(GLOBAL_CREDS);
  }
  onSetSettings(jsn);
});

// 插件功能活跃状态设置
$UD.onSetActive((jsn) => {
  const instance = ACTION_CACHES[jsn.context];
  if (instance) instance.setActive(jsn.active);
});

// 按键按下时发送的事件
$UD.onRun((jsn) => {
  const instance = ACTION_CACHES[jsn.context];
  if (!instance) $UD.emit('add', jsn);
  else instance.run();
});

// 移除插件的功能配置信息
$UD.onClear((jsn) => {
  if (jsn.param) {
    for (let i = 0; i < jsn.param.length; i++) {
      const context = jsn.param[i].context;
      if (ACTION_CACHES[context]) {
        ACTION_CACHES[context].destroy();
        delete ACTION_CACHES[context];
      }
    }
  }
});

// 重载/监听插件功能配置信息变化（来自 Property Inspector）
$UD.onParamFromApp((jsn) => onSetSettings(jsn));
$UD.onParamFromPlugin((jsn) => onSetSettings(jsn));

// 接收全局设置（凭证）
$UD.onDidReceiveGlobalSettings((jsn) => {
  const settings = (jsn && (jsn.param || jsn.settings)) || {};
  GLOBAL_CREDS = { ...GLOBAL_CREDS, ...pickCreds(settings) };
  broadcastCreds();
});

// 更新参数：per-key device IDs 及（若表单包含）凭证
function onSetSettings(jsn) {
  const settings = jsn.param || {};
  const context = jsn.context;
  const instance = ACTION_CACHES[context];
  if (!settings || JSON.stringify(settings) === '{}') return;

  // The toggle inspector carries the shared creds too. If any are present,
  // update global state, persist them, and broadcast to all keys.
  const creds = pickCreds(settings);
  if (Object.keys(creds).length) {
    const changed = CRED_KEYS.some((k) => creds[k] !== GLOBAL_CREDS[k]);
    GLOBAL_CREDS = { ...GLOBAL_CREDS, ...creds };
    if (changed) {
      $UD.setGlobalSettings(GLOBAL_CREDS);
      broadcastCreds();
    }
  }

  if (instance) {
    // Pass all non-credential settings through; each action reads the fields it
    // needs (aId/sId/cId, pressValue, or the sensor's t*/h* ids).
    const deviceSettings = {};
    for (const k of Object.keys(settings)) {
      if (!CRED_KEYS.includes(k)) deviceSettings[k] = settings[k];
    }
    instance.updateSettings(deviceSettings);
  }
}
