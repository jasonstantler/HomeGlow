import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import {
  DISPLAY_MODES_KEY,
  decideMode,
  normalizeModesSettings,
  scheduledModeAt,
} from '../utils/displayModes.js';
import { getServerTimezoneSync } from '../utils/timezone.js';

// How often the schedule is checked. A mode starts within this of its time.
const TICK_MS = 15 * 1000;
const PIN_STORAGE_KEY = 'homeglow:displayModePin';
const ACTIVITY_EVENTS = ['pointerdown', 'touchstart', 'keydown', 'wheel'];

const readPin = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(PIN_STORAGE_KEY) || 'null');
    if (raw && typeof raw === 'object' && 'modeId' in raw && 'scheduledAtPin' in raw) return raw;
  } catch { /* storage unavailable: no pin survives a reload */ }
  return null;
};
const writePin = (pin) => {
  try {
    if (pin) localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify(pin));
    else localStorage.removeItem(PIN_STORAGE_KEY);
  } catch { /* per-display convenience only */ }
};

/**
 * Runs this display's modes (utils/displayModes.js): which one is on, the pin,
 * waiting while the screen is touched, and saving a tab's layout to a mode.
 *
 * - deviceSettings: this display's raw device settings (modes live under
 *   DISPLAY_MODES_KEY)
 * - apiDeviceUrl: this display's device API base
 * - onSaved(settings): told the device settings a save returned
 * - enabled: false on a phone or before settings load; no mode is shown then
 */
export default function useDisplayModes({ deviceSettings, apiDeviceUrl, onSaved, enabled }) {
  const settings = useMemo(
    () => normalizeModesSettings(deviceSettings?.[DISPLAY_MODES_KEY]),
    [deviceSettings]
  );
  const [pin, setPinState] = useState(readPin);
  const [shownId, setShownId] = useState(null);
  const [scheduledId, setScheduledId] = useState(null);
  const lastActivityRef = useRef(0);
  const pinRef = useRef(pin);
  const shownRef = useRef(shownId);
  pinRef.current = pin;
  shownRef.current = shownId;

  const setPin = useCallback((next) => {
    writePin(next);
    pinRef.current = next;
    setPinState(next);
  }, []);

  // Touches, keys and use inside a plugin frame all count as someone at the
  // screen, so a mode change waits for them.
  useEffect(() => {
    if (!enabled) return undefined;
    const poke = () => { lastActivityRef.current = Date.now(); };
    const onMessage = (event) => { if (event?.data?.type === 'homeglow:activity') poke(); };
    ACTIVITY_EVENTS.forEach((type) => window.addEventListener(type, poke, { passive: true, capture: true }));
    window.addEventListener('message', onMessage);
    return () => {
      ACTIVITY_EVENTS.forEach((type) => window.removeEventListener(type, poke, { capture: true }));
      window.removeEventListener('message', onMessage);
    };
  }, [enabled]);

  const evaluate = useCallback(({ force = false } = {}) => {
    if (!enabled) {
      setShownId(null);
      return;
    }
    const known = new Set(settings.modes.map((mode) => mode.id));
    const scheduled = scheduledModeAt(settings.modes, new Date(), getServerTimezoneSync());
    setScheduledId(scheduled);
    let currentPin = pinRef.current;
    // A pin to a mode that was deleted is no pin.
    if (currentPin && currentPin.modeId !== null && !known.has(currentPin.modeId)) {
      setPin(null);
      currentPin = null;
    }
    const shown = known.has(shownRef.current) ? shownRef.current : null;
    const decision = decideMode({
      scheduledId: scheduled,
      pin: currentPin,
      shownId: shown,
      lastActivityMs: force ? -Infinity : lastActivityRef.current,
      nowMs: Date.now(),
      touchWaitMs: settings.touchWaitSeconds * 1000,
    });
    if (decision.pinExpired) setPin(null);
    setShownId(decision.show);
  }, [enabled, settings, setPin]);

  useEffect(() => {
    evaluate({ force: true });
    if (!enabled) return undefined;
    const timer = setInterval(() => evaluate(), TICK_MS);
    return () => clearInterval(timer);
  }, [enabled, evaluate]);

  // Pin a mode (or null, the normal layout) until the schedule next changes.
  // Someone chose it at the screen, so it shows at once.
  const pinMode = useCallback((modeId) => {
    const scheduledNow = scheduledModeAt(settings.modes, new Date(), getServerTimezoneSync());
    setScheduledId(scheduledNow);
    setPin({ modeId, scheduledAtPin: scheduledNow });
    setShownId(modeId);
  }, [settings.modes, setPin]);

  const unpin = useCallback(() => {
    setPin(null);
    evaluate({ force: true });
  }, [setPin, evaluate]);

  const saveModes = useCallback(async (modes) => {
    const response = await axios.patch(`${apiDeviceUrl}/settings`, {
      [DISPLAY_MODES_KEY]: { ...(deviceSettings?.[DISPLAY_MODES_KEY] || {}), modes },
    });
    onSaved?.(response.data || {});
  }, [apiDeviceUrl, deviceSettings, onSaved]);

  // Save { name: {x,y,w,h} } as a mode's layout for a tab.
  const saveTabLayout = useCallback(async (modeId, tabNumber, items) => {
    const modes = settings.modes.map((mode) => (mode.id === modeId
      ? { ...mode, layouts: { ...mode.layouts, [tabNumber]: items } }
      : mode));
    try {
      await saveModes(modes);
    } catch (error) {
      console.error('Error saving the mode layout:', error);
    }
  }, [settings.modes, saveModes]);

  // Save the layout editor's drafts: { tab: { saved, hidden } } for one mode.
  const saveModeTabs = useCallback(async (modeId, drafts) => {
    const modes = settings.modes.map((mode) => {
      if (mode.id !== modeId) return mode;
      const layouts = { ...mode.layouts };
      const hidden = { ...mode.hidden };
      Object.entries(drafts).forEach(([tab, draft]) => {
        layouts[tab] = draft.saved;
        if (draft.hidden.length > 0) hidden[tab] = draft.hidden;
        else delete hidden[tab];
      });
      return { ...mode, layouts, hidden };
    });
    await saveModes(modes);
  }, [settings.modes, saveModes]);

  const shownMode = settings.modes.find((mode) => mode.id === shownId) || null;

  return {
    settings,
    shownMode,
    scheduledId,
    pinned: Boolean(pin),
    pinMode,
    unpin,
    saveTabLayout,
    saveModeTabs,
    lastActivityRef,
  };
}
