let ACTION_SETTING = {};
let form = '';
$UD.connect();

$UD.onConnected(() => {
  form = document.querySelector('#property-inspector');

  // Show the form now that the socket is up.
  document.querySelector('.udpi-wrapper').classList.remove('hidden');

  // Pre-fill the shared credentials from global settings.
  $UD.getGlobalSettings();

  // Send settings to the main service on any change.
  form.addEventListener(
    'input',
    Utils.debounce(() => {
      ACTION_SETTING = Utils.getFormValue(form);
      $UD.sendParamFromPlugin(ACTION_SETTING);
    })
  );
});

// Per-key settings (device IDs, and a snapshot of creds).
$UD.onAdd((jsonObj) => {
  if (jsonObj && jsonObj.param) settingSaveParam(jsonObj.param);
});

$UD.onParamFromApp((jsonObj) => {
  if (jsonObj && jsonObj.param) settingSaveParam(jsonObj.param);
});

// Shared credentials from global settings.
$UD.onDidReceiveGlobalSettings((jsonObj) => {
  const creds = (jsonObj && (jsonObj.param || jsonObj.settings)) || {};
  if (Object.keys(creds).length) {
    ACTION_SETTING = { ...ACTION_SETTING, ...creds };
    Utils.setFormValue(ACTION_SETTING, form);
  }
});

function settingSaveParam(params) {
  ACTION_SETTING = { ...ACTION_SETTING, ...params };
  Utils.setFormValue(ACTION_SETTING, form);
}
