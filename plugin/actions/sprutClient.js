// Singleton Spruthub connection manager shared by every key on the deck.
//
// The `spruthub-client` npm package speaks WebSocket JSON-RPC to a Sprut.hub
// server and handles the email/password/serial login handshake for us. We keep
// a single authenticated client per credential set so N keys don't open N
// sockets.

import { Sprut } from 'spruthub-client';

// The Sprut constructor requires a `logger` (used as `this.log`, with
// .info/.warn/.error/.debug). Route it through console so plugin logs are
// visible in the UlanziStudio node inspector.
const logger = {
  info: (...a) => console.log('[spruthub]', ...a),
  warn: (...a) => console.warn('[spruthub]', ...a),
  error: (...a) => console.error('[spruthub]', ...a),
  debug: (...a) => console.log('[spruthub][debug]', ...a),
};

let client = null;
let clientKey = '';
let connectPromise = null;

// Handlers notified on every characteristic push event from the hub.
// Each receives ({ aId, sId, cId, value }) where value is the raw control
// value object, e.g. { boolValue: true }.
const changeHandlers = new Set();

// Register a handler for live characteristic updates. Returns an unsubscribe fn.
function onCharacteristicChange(handler) {
  changeHandlers.add(handler);
  return () => changeHandlers.delete(handler);
}

// Tap the client's WebSocket message handler so we can see the server-push
// `event.characteristic` (EVENT_UPDATE) messages that spruthub-client itself
// only forwards for logs and otherwise drops. This is how we get real-time
// state without polling.
function installEventTap(c) {
  const orig = c.onMessage.bind(c);
  c.onMessage = (data) => {
    try {
      const parsed = JSON.parse(data);
      const chr = parsed && parsed.event && parsed.event.characteristic;
      if (chr && Array.isArray(chr.characteristics)) {
        for (const ch of chr.characteristics) {
          for (const handler of changeHandlers) {
            try {
              handler({ aId: ch.aId, sId: ch.sId, cId: ch.cId, value: ch.control && ch.control.value });
            } catch (e) {
              logger.warn('change handler error:', e.message);
            }
          }
        }
      }
    } catch { /* not JSON / not our concern */ }
    return orig(data);
  };
}

// Identity of a credential set — recreate the client when any of these change.
function credsKey(creds) {
  return [creds.wsUrl, creds.email, creds.password, creds.serial].join('|');
}

function validateCreds(creds) {
  const missing = ['wsUrl', 'email', 'password', 'serial'].filter(
    (k) => !creds || !creds[k]
  );
  if (missing.length) {
    throw new Error(`Missing Spruthub credentials: ${missing.join(', ')}`);
  }
}

// Lazily build (and connect+authenticate) a client for the given creds,
// reusing an existing one when the creds are unchanged.
async function getClient(creds) {
  validateCreds(creds);
  const key = credsKey(creds);

  // Fast path: a ready client for these exact creds already exists.
  if (client && clientKey === key && !connectPromise) {
    return client;
  }

  // A connect is already in flight (possibly started by another key). If it's
  // for the same creds, share it; every concurrent caller awaits the SAME
  // promise so we never run two auth handshakes at once (which corrupts the
  // email/password challenge -> "Expected password question type").
  if (connectPromise && clientKey === key) {
    return connectPromise;
  }

  // Different creds (or first use): build a single shared connect promise that
  // every concurrent caller awaits. The promise clears itself when settled so
  // the fast path applies afterwards.
  clientKey = key;
  const p = (async () => {
    // Tear down any previous client for old creds.
    if (client) {
      try { await client.close(); } catch (e) { logger.warn('close error:', e.message); }
      client = null;
    }

    const c = new Sprut({
      wsUrl: creds.wsUrl,
      sprutEmail: creds.email,
      sprutPassword: creds.password,
      serial: creds.serial,
      logger,
    });
    installEventTap(c);

    await c.connected();
    // Force a single authentication now (serialized in this one promise), and
    // subscribe so the hub streams characteristic pushes to our event tap.
    try {
      await c.ensureConnectionAndAuthentication();
      await c.subscribeLogs(() => {});
    } catch (e) {
      logger.warn('auth/subscribe failed:', e.message);
    }

    client = c;
    return c;
  })();

  connectPromise = p;
  // Only the creator of this promise clears it (and only if still current).
  p.finally(() => { if (connectPromise === p) connectPromise = null; });
  return p;
}

// Set a boolean characteristic (bulb on/off).
// Maps to execute('update', { accessoryId, serviceId, characteristicId,
//   control: { value: <bool> } }), which the client wraps into the
// { characteristic: { update: { aId, sId, cId, control: { value: { boolValue } } } } }
// JSON-RPC payload.
async function setValue(creds, ids, boolValue) {
  return sendValue(creds, ids, Boolean(boolValue));
}

// Write an arbitrary value to a characteristic. The client picks the wire type
// from the JS type: boolean -> boolValue, integer -> intValue, float ->
// floatValue, string -> stringValue. Used by the button action to emit a
// ProgrammableSwitchEvent (intValue 0/1/2 = single/double/long press).
async function sendValue(creds, ids, value) {
  const c = await getClient(creds);
  const result = await c.execute('update', {
    accessoryId: Number(ids.aId),
    serviceId: Number(ids.sId),
    characteristicId: Number(ids.cId),
    control: { value },
  });
  if (result && result.isSuccess === false) {
    throw new Error(result.message || `Spruthub error code ${result.code}`);
  }
  return result;
}

// --- Shared accessory-list cache -----------------------------------------
// listAccessories fetches the ENTIRE hub (all devices/services/characteristics)
// and can take several seconds. Every key read used to call it, so N keys = N
// full-hub fetches hammering the one socket -> lag. We cache the list and share
// it: concurrent reads await a single in-flight fetch, and the result is reused
// for a short TTL. Live push events (event tap) keep icons current between
// fetches, so a few seconds of staleness is fine.
let accCache = null;         // last accessories array
let accCacheAt = 0;          // timestamp
let accInFlight = null;      // in-flight fetch promise
const ACC_TTL_MS = 5000;

async function getAccessories(creds, force = false) {
  const now = Date.now();
  if (!force && accCache && now - accCacheAt < ACC_TTL_MS) return accCache;
  if (accInFlight) return accInFlight;

  accInFlight = (async () => {
    const c = await getClient(creds);
    const list = await c.listAccessories('services,characteristics');
    const accessories = list && list.data ? list.data : list;
    if (Array.isArray(accessories)) {
      accCache = accessories;
      accCacheAt = Date.now();
    }
    return Array.isArray(accessories) ? accessories : accCache;
  })();

  try {
    return await accInFlight;
  } finally {
    accInFlight = null;
  }
}

// Read the current boolean value of a characteristic, used to seed the toggle
// state / icon. Returns a boolean, or null if it can't be determined.
async function readValue(creds, ids) {
  const c = await getClient(creds);
  const accessories = await getAccessories(creds);
  if (!Array.isArray(accessories)) return null;

  const info = c.getCharacteristicInfo(
    accessories,
    Number(ids.aId),
    Number(ids.sId),
    Number(ids.cId)
  );
  if (!info || !info.characteristic) return null;

  let value = info.characteristic.value;
  if (value === null || value === undefined) return null;
  // Sprut.hub reports the value wrapped, e.g. { boolValue: false }.
  if (typeof value === 'object') {
    if ('boolValue' in value) return Boolean(value.boolValue);
    if ('intValue' in value) return Boolean(value.intValue);
    return null;
  }
  if (typeof value === 'boolean') return value;
  // Some hubs report bools as 0/1 or "true"/"false".
  return !(['false', '0', '', 'off'].indexOf(String(value).toLowerCase().trim()) + 1);
}

// Read the current raw (unwrapped) value of a characteristic — number for
// sensors (doubleValue/intValue), boolean, or string. Returns null if unknown.
async function readRaw(creds, ids) {
  const c = await getClient(creds);
  const accessories = await getAccessories(creds);
  if (!Array.isArray(accessories)) return null;

  const info = c.getCharacteristicInfo(
    accessories,
    Number(ids.aId),
    Number(ids.sId),
    Number(ids.cId)
  );
  if (!info || !info.characteristic) return null;
  return unwrap(info.characteristic.value);
}

// Unwrap a Sprut control value object to a JS primitive.
function unwrap(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') {
    if ('doubleValue' in value) return value.doubleValue;
    if ('floatValue' in value) return value.floatValue;
    if ('intValue' in value) return value.intValue;
    if ('boolValue' in value) return value.boolValue;
    if ('stringValue' in value) return value.stringValue;
    return null;
  }
  return value;
}

export { getClient, setValue, sendValue, readValue, readRaw, unwrap, onCharacteristicChange };
