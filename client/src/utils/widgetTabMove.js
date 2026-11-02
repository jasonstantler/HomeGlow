// Moving widgets between tabs in Move/Resize mode, and the long-press menu's
// size presets. Everything here is plain arithmetic on grid items
// ({ i, x, y, w, h }), so it can be tested without a browser; the dashboard
// (WidgetContainer, useCrossTabDrag) does the DOM and network parts.

const CORE_WIDGET_ID_TO_NAME = {
  'calendar-widget': 'calendar',
  'chores-widget': 'chores',
  'photos-widget': 'photos',
  'weather-widget': 'weather',
};
const CORE_WIDGET_NAME_TO_ID = Object.fromEntries(
  Object.entries(CORE_WIDGET_ID_TO_NAME).map(([id, name]) => [name, id])
);

/** The name a widget is stored under ('calendar', 'plugin:grill.html') for its grid id, or null. */
export function widgetNameFromId(widgetId) {
  if (typeof widgetId !== 'string') return null;
  if (CORE_WIDGET_ID_TO_NAME[widgetId]) return CORE_WIDGET_ID_TO_NAME[widgetId];
  if (widgetId.startsWith('plugin-')) return `plugin:${widgetId.slice(7)}`;
  return null;
}

/** The grid id for a stored widget name; the reverse of widgetNameFromId. */
export function widgetIdFromName(widgetName) {
  if (typeof widgetName !== 'string') return null;
  if (CORE_WIDGET_NAME_TO_ID[widgetName]) return CORE_WIDGET_NAME_TO_ID[widgetName];
  if (widgetName.startsWith('plugin:')) return `plugin-${widgetName.slice(7)}`;
  return null;
}

/** A tab's layout map (config_json arrives as a string, an object or nothing). */
export function tabLayoutMap(tab) {
  const raw = tab?.config_json;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw !== 'string' || !raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** The tab's whole entry for a widget (its place and per-tab settings), or null. */
export function tabEntryFor(tabs, tabNumber, widgetName) {
  const tab = (tabs || []).find((candidate) => (candidate?.number ?? candidate?.id) === tabNumber);
  const entry = tabLayoutMap(tab)[widgetName];
  return entry && typeof entry === 'object' ? { ...entry } : null;
}

/** Whether the widget is already on that tab. */
export function tabHasWidget(tabs, tabNumber, widgetName) {
  return tabEntryFor(tabs, tabNumber, widgetName) !== null;
}

/**
 * The tabs offered by "Move to tab" and "Duplicate to tab": every tab but the
 * one the widget is on, each saying whether the widget is already there (a
 * widget shows at most once on a tab).
 */
export function tabChoicesFor(tabs, widgetName, currentTab) {
  return (tabs || [])
    .map((tab) => ({ ...tab, number: tab.number ?? tab.id }))
    .filter((tab) => tab.number !== currentTab)
    .map((tab) => ({
      number: tab.number,
      label: tab.label || `Tab ${tab.number}`,
      icon: tab.icon,
      alreadyThere: tabHasWidget(tabs, tab.number, widgetName),
    }));
}

/**
 * Which screen edge a point is held against while dragging: -1 left, 1 right,
 * 0 neither. The band is 5% of the width, never under 40px, so a finger can
 * find it on a phone-sized window and on a wall display alike.
 */
export function edgeBandWidth(viewportWidth) {
  return Math.max(40, Math.round((viewportWidth || 0) * 0.05));
}

export function edgeSideAt(x, viewportWidth) {
  if (!Number.isFinite(x) || !viewportWidth) return 0;
  const band = edgeBandWidth(viewportWidth);
  if (x <= band) return -1;
  if (x >= viewportWidth - band) return 1;
  return 0;
}

const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/**
 * The grid cell under a widget's top-left corner, from page pixels. `left` and
 * `top` are where the corner is on screen; `gridLeft` and `gridTop` where the
 * grid starts. Rounded to the nearest cell and kept on the grid.
 */
export function cellAtPoint({ left, top, gridLeft, gridTop, cols, containerWidth, rowHeight, gap, w }) {
  const colWidth = (containerWidth - gap * (cols - 1)) / cols;
  const x = Math.round((left - gridLeft) / (colWidth + gap));
  const y = Math.round((top - gridTop) / (rowHeight + gap));
  const width = Math.min(Math.max(1, w || 1), cols);
  return {
    x: Math.max(0, Math.min(cols - width, Number.isFinite(x) ? x : 0)),
    y: Math.max(0, Number.isFinite(y) ? y : 0),
  };
}

/**
 * The first free cell, top to bottom and left to right, for a w×h widget among
 * `items`. Below everything when nothing fits higher up.
 */
export function findFreeSpot(items, w, h, cols) {
  const width = Math.min(Math.max(1, w), cols);
  const lowest = (items || []).reduce((low, item) => Math.max(low, item.y + item.h), 0);
  for (let y = 0; y <= lowest; y += 1) {
    for (let x = 0; x <= cols - width; x += 1) {
      const candidate = { x, y, w: width, h };
      if (!(items || []).some((item) => overlaps(item, candidate))) return { x, y };
    }
  }
  return { x: 0, y: lowest };
}

/**
 * Put `placed` exactly where it says and move whatever it lands on straight
 * down until nothing overlaps, cascading to whatever those land on. Nothing
 * moves sideways or up, and widgets it doesn't touch stay put. Returns the
 * whole layout in the order given, the placed item replacing its old entry
 * (or added at the end when it wasn't there).
 */
export function placeAndPush(items, placed) {
  const others = (items || []).filter((item) => item.i !== placed.i).map((item) => ({ ...item }));
  const settled = [{ ...placed }];
  const byY = [...others].sort((a, b) => a.y - b.y || a.x - b.x);
  byY.forEach((item) => {
    let hit = settled.find((other) => overlaps(other, item));
    while (hit) {
      item.y = hit.y + hit.h;
      hit = settled.find((other) => overlaps(other, item));
    }
    settled.push(item);
  });
  const finalById = new Map(settled.map((item) => [item.i, item]));
  const order = (items || []).some((item) => item.i === placed.i)
    ? (items || []).map((item) => item.i)
    : [...(items || []).map((item) => item.i), placed.i];
  return order.map((id) => finalById.get(id));
}

export const SIZE_PRESETS = ['small', 'medium', 'half', 'full'];

/**
 * Rows of the grid that fit on screen: the window's height less the page
 * padding and the dock, in whole rows.
 */
export function visibleRows({ viewportHeight, rowHeight, gap, reserved = 128 }) {
  const usable = Math.max(0, (viewportHeight || 0) - reserved);
  return Math.max(2, Math.floor((usable + gap) / (rowHeight + gap)));
}

/**
 * The size a preset gives a widget, in live grid units. Small is a third of
 * the width and a sixth of the screen's height, medium half and a quarter,
 * half screen the whole width and half the height, full screen all of it.
 * Never below the widget's minimum.
 */
export function sizeForPreset(preset, { cols, rows, minW = 1, minH = 1 }) {
  const shapes = {
    small: { w: Math.round(cols / 3), h: Math.round(rows / 6) },
    medium: { w: Math.round(cols / 2), h: Math.round(rows / 4) },
    half: { w: cols, h: Math.floor(rows / 2) },
    full: { w: cols, h: rows },
  };
  const shape = shapes[preset];
  if (!shape) return null;
  return {
    w: Math.min(cols, Math.max(minW, shape.w, 1)),
    h: Math.max(minH, shape.h, 1),
  };
}

/**
 * The widget resized to a preset: half and full screen start at the left
 * edge, the others keep their place (moved left only as far as they must to
 * stay on the grid). Anything it now covers is pushed down.
 */
export function applySizePreset(items, widgetId, preset, { cols, rows }) {
  const item = (items || []).find((candidate) => candidate.i === widgetId);
  if (!item) return items;
  const size = sizeForPreset(preset, { cols, rows, minW: item.minW, minH: item.minH });
  if (!size) return items;
  const x = preset === 'half' || preset === 'full' ? 0 : Math.max(0, Math.min(item.x, cols - size.w));
  return placeAndPush(items, { ...item, ...size, x });
}

/**
 * Where an arriving widget goes on its new tab: under the finger when it was
 * dropped there, otherwise the first spot it fits. Either way it keeps its
 * size (within the grid) and anything in the way is pushed down.
 */
export function placeArrival(items, { i, w, h, minW, minH, cell, cols }) {
  const others = (items || []).filter((item) => item.i !== i);
  const width = Math.min(cols, Math.max(1, w));
  const spot = cell
    ? { x: Math.max(0, Math.min(cell.x, cols - width)), y: Math.max(0, cell.y) }
    : findFreeSpot(others, width, h, cols);
  const existing = (items || []).find((item) => item.i === i) || {};
  return placeAndPush(items, {
    ...existing,
    i,
    x: spot.x,
    y: spot.y,
    w: width,
    h,
    ...(minW != null ? { minW } : {}),
    ...(minH != null ? { minH } : {}),
  });
}
