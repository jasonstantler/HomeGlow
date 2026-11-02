// Display modes: named looks the wall switches to on a schedule (Morning,
// Dinner prep, Night...). Each mode is this display's own, kept in its device
// settings under `displayModes`, because the layouts it saves are this display's
// layouts — widget positions are already per display (widget-assignments).
//
// A mode can:
//   - turn on by schedule: days of the week plus a start and end time, read
//     in the household time zone; an end at or before the start runs past
//     midnight into the next day. Schedules may not overlap (findOverlaps).
//   - start on a tab, and go back to it after the display sits idle.
//   - hold the screen dimmed almost to black (displayDim.js setDimmingHold).
//   - keep its own layout for any tab: a snapshot of where each widget sat.
//
// Widgets added to a tab after its snapshot was saved go in the first open
// spot that fits on screen, else are hidden while the mode is on, and the
// mode is flagged out of date in Admin (placeModeLayout, staleModeTabs).
//
// Everything here is pure, for tests; hooks/useDisplayModes.js runs it.

// Where a display keeps its modes in its device settings.
export const DISPLAY_MODES_KEY = 'displayModes';

// Window events: Admin asks the dashboard to open the layout editor
// ({ detail: { modeId, tab } }), and the editor says it saved.
export const OPEN_MODE_LAYOUT_EDITOR_EVENT = 'homeglow:open-mode-layout-editor';
export const MODE_LAYOUTS_SAVED_EVENT = 'homeglow:mode-layouts-saved';

export const MINUTES_PER_DAY = 24 * 60;
export const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;

export const MODE_COLORS = ['#D9A441', '#B4683F', '#A24E2A', '#7C8B6A', '#5B7A99', '#8A6FA8', '#4A3A2E', '#9A8F82'];

export const DEFAULT_MODES_SETTINGS = {
  modes: [],
  showLabel: true,
  fade: true,
  touchWaitSeconds: 60,
  returnMinutes: 3,
};

// The dim level a mode holds the screen at: "basically off".
export const MODE_DIM_LEVEL = 0.04;

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseTime(value) {
  const match = typeof value === 'string' ? value.match(TIME_PATTERN) : null;
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

const clampInt = (value, min, max, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};

function normalizeLayoutItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const x = Number(raw.x);
  const y = Number(raw.y);
  const w = Number(raw.w);
  const h = Number(raw.h);
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
  return { x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)), w: Math.round(w), h: Math.round(h) };
}

// { tab: [widget names] } a mode hides on that tab.
function normalizeHidden(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [tab, names] of Object.entries(raw)) {
    const tabNumber = Number(tab);
    if (!Number.isInteger(tabNumber) || !Array.isArray(names)) continue;
    const clean = [...new Set(names.filter((name) => typeof name === 'string' && name))];
    if (clean.length > 0) out[tabNumber] = clean;
  }
  return out;
}

function normalizeLayouts(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [tab, widgets] of Object.entries(raw)) {
    const tabNumber = Number(tab);
    if (!Number.isInteger(tabNumber) || !widgets || typeof widgets !== 'object') continue;
    const items = {};
    for (const [name, item] of Object.entries(widgets)) {
      const clean = normalizeLayoutItem(item);
      if (clean) items[name] = clean;
    }
    if (Object.keys(items).length > 0) out[tabNumber] = items;
  }
  return out;
}

export function normalizeSchedule(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const days = Array.isArray(raw.days)
    ? [...new Set(raw.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
    : [];
  const start = parseTime(raw.start);
  const end = parseTime(raw.end);
  if (days.length === 0 || start == null || end == null) return null;
  return { days, start: raw.start, end: raw.end };
}

export function normalizeMode(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id) return null;
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 40) : '';
  if (!name) return null;
  const startTab = Number(raw.startTab);
  return {
    id: raw.id,
    name,
    color: typeof raw.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.color) ? raw.color : MODE_COLORS[0],
    schedule: normalizeSchedule(raw.schedule),
    startTab: Number.isInteger(startTab) && startTab > 0 ? startTab : null,
    dim: raw.dim === true,
    layouts: normalizeLayouts(raw.layouts),
    hidden: normalizeHidden(raw.hidden),
  };
}

export function normalizeModesSettings(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const seen = new Set();
  const modes = (Array.isArray(source.modes) ? source.modes : [])
    .map(normalizeMode)
    .filter((mode) => mode && !seen.has(mode.id) && seen.add(mode.id));
  return {
    modes,
    showLabel: source.showLabel !== false,
    fade: source.fade !== false,
    touchWaitSeconds: clampInt(source.touchWaitSeconds, 0, 600, DEFAULT_MODES_SETTINGS.touchWaitSeconds),
    returnMinutes: clampInt(source.returnMinutes, 0, 120, DEFAULT_MODES_SETTINGS.returnMinutes),
  };
}

export function newModeId() {
  return `mode-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// ---- Time --------------------------------------------------------------

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// Minutes since Sunday 00:00 in `timeZone` (else the device's own zone).
export function minuteOfWeek(date = new Date(), timeZone) {
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone, weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
      }).formatToParts(date);
      const get = (type) => parts.find((part) => part.type === type)?.value;
      const day = WEEKDAYS[get('weekday')];
      const hour = Number(get('hour')) % 24;
      const minute = Number(get('minute'));
      if (day != null && Number.isFinite(hour) && Number.isFinite(minute)) {
        return day * MINUTES_PER_DAY + hour * 60 + minute;
      }
    } catch {
      // Unknown zone: fall through to the device's clock.
    }
  }
  return date.getDay() * MINUTES_PER_DAY + date.getHours() * 60 + date.getMinutes();
}

// The schedule as half-open [start, end) spans within one week, minutes since
// Sunday 00:00. A span that runs past Saturday midnight is split in two.
export function scheduleSpans(schedule) {
  const clean = normalizeSchedule(schedule);
  if (!clean) return [];
  const start = parseTime(clean.start);
  let end = parseTime(clean.end);
  if (end <= start) end += MINUTES_PER_DAY;
  const spans = [];
  for (const day of clean.days) {
    const a = day * MINUTES_PER_DAY + start;
    const b = day * MINUTES_PER_DAY + end;
    if (b <= MINUTES_PER_WEEK) spans.push([a, b]);
    else spans.push([a, MINUTES_PER_WEEK], [0, b - MINUTES_PER_WEEK]);
  }
  return spans;
}

export function isScheduleActive(schedule, date = new Date(), timeZone) {
  const now = minuteOfWeek(date, timeZone);
  return scheduleSpans(schedule).some(([a, b]) => now >= a && now < b);
}

// The scheduled mode right now, or null for the normal layout.
export function scheduledModeAt(modes, date = new Date(), timeZone) {
  const list = Array.isArray(modes) ? modes : [];
  const hit = list.find((mode) => mode.schedule && isScheduleActive(mode.schedule, date, timeZone));
  return hit ? hit.id : null;
}

// Every pair of modes whose schedules share a minute, with the first shared
// span, for the Admin warning. Schedules may not overlap.
export function findOverlaps(modes) {
  const list = (Array.isArray(modes) ? modes : []).filter((mode) => mode.schedule);
  const found = [];
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const shared = sharedSpan(scheduleSpans(list[i].schedule), scheduleSpans(list[j].schedule));
      if (shared) found.push({ a: list[i].id, b: list[j].id, from: shared[0], to: shared[1] });
    }
  }
  return found;
}

function sharedSpan(spansA, spansB) {
  for (const [a1, b1] of spansA) {
    for (const [a2, b2] of spansB) {
      const from = Math.max(a1, a2);
      const to = Math.min(b1, b2);
      if (from < to) return [from, to];
    }
  }
  return null;
}

// ---- Which mode shows ------------------------------------------------------

// The director's one decision. `pin` is { modeId, scheduledAtPin }: what was
// pinned (null for the normal layout) and what the schedule said when it was.
// A pin lasts until the schedule changes its mind. `shownId` is on screen now;
// a change waits while someone has touched the screen in the last
// `touchWaitMs` (so it never moves under a finger).
//
// Returns { want, pinExpired, show }: the mode wanted now, whether the pin
// just ran out, and what to show (want, or shownId while held off).
export function decideMode({ scheduledId, pin, shownId, lastActivityMs, nowMs, touchWaitMs }) {
  const pinExpired = Boolean(pin) && pin.scheduledAtPin !== scheduledId;
  const want = pin && !pinExpired ? pin.modeId : scheduledId;
  const touchedRecently = Number.isFinite(lastActivityMs) && nowMs - lastActivityMs < touchWaitMs;
  const show = want !== shownId && touchedRecently ? shownId : want;
  return { want, pinExpired, show };
}

// ---- Layouts ---------------------------------------------------------------

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// The first spot a w×h widget fits, top to bottom then left to right, inside
// `cols` columns and `rows` rows, clear of `taken`. Null when there's none.
export function firstOpenSpot({ w, h }, taken, cols = 12, rows = Infinity) {
  const width = Math.min(w, cols);
  const lastRow = Number.isFinite(rows) ? rows - h : Math.max(0, ...taken.map((t) => t.y + t.h));
  for (let y = 0; y <= lastRow; y += 1) {
    for (let x = 0; x + width <= cols; x += 1) {
      const candidate = { x, y, w: width, h };
      if (!taken.some((item) => overlaps(item, candidate))) return candidate;
    }
  }
  return null;
}

// Where every widget on a tab goes while a mode with a layout for it is on.
// `saved` is the mode's snapshot for the tab ({ name: {x,y,w,h} }); `widgets`
// is what's on the tab now: [{ name, size: {w,h} }] in a stable order.
// `hiddenNames` are widgets the mode hides on this tab, and `available` the
// names turned on anywhere on this display: a snapshot can bring in a widget
// from another tab. Returns { placed: { name: {x,y,w,h} }, hidden: [names],
// added: [names] }: snapshot widgets where they were saved, newcomers in the
// first open spot on screen (`rows` visible rows), and newcomers with no room
// hidden. Widgets the mode hides are in neither.
export function placeModeLayout({ saved, widgets, hiddenNames = [], available = null, cols = 12, rows = Infinity }) {
  const placed = {};
  const hidden = [];
  const added = [];
  const taken = [];
  const newcomers = [];
  const skip = new Set(hiddenNames);
  const onTab = new Set(widgets.map((widget) => widget.name));
  for (const widget of widgets) {
    if (skip.has(widget.name)) continue;
    const item = saved?.[widget.name];
    if (item) {
      placed[widget.name] = { ...item };
      taken.push(item);
    } else {
      newcomers.push(widget);
    }
  }
  // Brought in from other tabs: shown where saved, while still turned on.
  for (const [name, item] of Object.entries(saved || {})) {
    if (onTab.has(name) || skip.has(name)) continue;
    if (available && !available.has(name)) continue;
    placed[name] = { ...item };
    taken.push(item);
  }
  for (const widget of newcomers) {
    const spot = firstOpenSpot({ w: widget.size?.w || 4, h: widget.size?.h || 3 }, taken, cols, rows);
    if (spot) {
      placed[widget.name] = spot;
      taken.push(spot);
      added.push(widget.name);
    } else {
      hidden.push(widget.name);
    }
  }
  return { placed, hidden, added };
}

// The tabs whose saved layout is missing widgets that are on the tab now:
// { tabNumber: [names] }. `onTab` is { tabNumber: [names] }.
export function staleModeTabs(mode, onTab) {
  const out = {};
  for (const [tab, saved] of Object.entries(mode?.layouts || {})) {
    const hidden = new Set(mode?.hidden?.[tab] || []);
    const missing = (onTab?.[tab] || []).filter((name) => !saved[name] && !hidden.has(name));
    if (missing.length > 0) out[tab] = missing;
  }
  return out;
}

// Rows of the grid that fit on screen above the dock.
export function visibleGridRows(viewportHeight, { rowHeight, gap }, reserved = 80) {
  const pitch = rowHeight + gap;
  if (!(pitch > 0)) return Infinity;
  return Math.max(1, Math.floor((viewportHeight - reserved + gap) / pitch));
}

// "Mon–Fri · 6:00 → 9:00" style summary pieces, for labels.
export function scheduleDaysKey(days) {
  const set = [...new Set(days)].sort().join(',');
  if (set === '0,1,2,3,4,5,6') return 'everyDay';
  if (set === '1,2,3,4,5') return 'weekdays';
  if (set === '0,6') return 'weekends';
  return null;
}

// ---- The layout editor's draft for one tab -------------------------------
// A draft is { saved: { name: {x,y,w,h} }, hidden: [names] }, what a mode
// stores for the tab in layouts[tab] and hidden[tab].

// Start from the mode's layout for the tab, else from the tab's usual one.
// `widgets` is what's on the tab normally: [{ name, layout: {x,y,w,h} | null }].
export function startDraft(mode, tab, widgets) {
  const saved = mode?.layouts?.[tab];
  if (saved) {
    // Widgets added to the tab since show where the wall shows them: the
    // first open spot.
    const hidden = [...(mode.hidden?.[tab] || [])];
    const draft = { saved: { ...saved }, hidden };
    for (const widget of widgets) {
      if (draft.saved[widget.name] || hidden.includes(widget.name)) continue;
      const size = widget.layout ? { w: widget.layout.w, h: widget.layout.h } : { w: 4, h: 3 };
      draft.saved[widget.name] = firstOpenSpot(size, Object.values(draft.saved));
    }
    return draft;
  }
  const draft = { saved: {}, hidden: [] };
  for (const widget of widgets) {
    if (widget.layout) {
      draft.saved[widget.name] = { ...widget.layout };
    } else {
      draft.saved[widget.name] = firstOpenSpot({ w: 4, h: 3 }, Object.values(draft.saved));
    }
  }
  return draft;
}

// Show a widget in this mode: back where it was saved, else in the first open
// spot on screen, else below everything.
export function showInDraft(draft, name, size = { w: 4, h: 3 }, rows = Infinity) {
  const hidden = draft.hidden.filter((item) => item !== name);
  if (draft.saved[name]) return { saved: draft.saved, hidden };
  const taken = Object.values(draft.saved);
  const spot = firstOpenSpot(size, taken, 12, rows) || firstOpenSpot(size, taken, 12);
  return { saved: { ...draft.saved, [name]: spot }, hidden };
}

// Hide a widget in this mode. One that's on the tab normally is remembered as
// hidden, so it doesn't come back as a newcomer.
export function hideInDraft(draft, name, onTab) {
  const { [name]: _removed, ...saved } = draft.saved;
  const hidden = onTab && !draft.hidden.includes(name) ? [...draft.hidden, name] : draft.hidden;
  return { saved, hidden };
}
