import { describe, it, expect } from 'vitest';
import {
  applySizePreset,
  cellAtPoint,
  edgeSideAt,
  findFreeSpot,
  placeAndPush,
  placeArrival,
  sizeForPreset,
  tabChoicesFor,
  tabEntryFor,
  visibleRows,
  widgetIdFromName,
  widgetNameFromId,
} from './widgetTabMove.js';

const overlap = (items) => {
  for (let a = 0; a < items.length; a += 1) {
    for (let b = a + 1; b < items.length; b += 1) {
      const p = items[a]; const q = items[b];
      if (p.x < q.x + q.w && p.x + p.w > q.x && p.y < q.y + q.h && p.y + p.h > q.y) return [p.i, q.i];
    }
  }
  return null;
};

const tabs = [
  { number: 1, label: 'Home', icon: 'home', config_json: JSON.stringify({ calendar: { layout_x: 0, layout_y: 0, layout_w: 8, layout_h: 5, view: 'week' } }) },
  { number: 2, label: 'Kitchen', icon: 'star', config_json: { calendar: { layout_x: null } } },
  { number: 3, label: '', icon: 'heart', config_json: null },
];

describe('widget names and ids', () => {
  it('round-trips core widgets and plugins', () => {
    expect(widgetNameFromId('calendar-widget')).toBe('calendar');
    expect(widgetNameFromId('plugin-grill.html')).toBe('plugin:grill.html');
    expect(widgetIdFromName('weather')).toBe('weather-widget');
    expect(widgetIdFromName('plugin:grill.html')).toBe('plugin-grill.html');
    expect(widgetNameFromId('mystery')).toBe(null);
    expect(widgetIdFromName(undefined)).toBe(null);
  });
});

describe('tab entries', () => {
  it('reads a tab entry whether config_json is a string or an object', () => {
    expect(tabEntryFor(tabs, 1, 'calendar')).toEqual({ layout_x: 0, layout_y: 0, layout_w: 8, layout_h: 5, view: 'week' });
    expect(tabEntryFor(tabs, 2, 'calendar')).toEqual({ layout_x: null });
    expect(tabEntryFor(tabs, 3, 'calendar')).toBe(null);
    expect(tabEntryFor(tabs, 9, 'calendar')).toBe(null);
  });

  it('offers every other tab and says where the widget already is', () => {
    expect(tabChoicesFor(tabs, 'calendar', 1)).toEqual([
      { number: 2, label: 'Kitchen', icon: 'star', alreadyThere: true },
      { number: 3, label: 'Tab 3', icon: 'heart', alreadyThere: false },
    ]);
  });
});

describe('edgeSideAt', () => {
  it('finds the left and right bands, 5% of the width but never under 40px', () => {
    expect(edgeSideAt(10, 1080)).toBe(-1);
    expect(edgeSideAt(54, 1080)).toBe(-1);
    expect(edgeSideAt(60, 1080)).toBe(0);
    expect(edgeSideAt(1070, 1080)).toBe(1);
    expect(edgeSideAt(39, 400)).toBe(-1);
    expect(edgeSideAt(200, 400)).toBe(0);
    expect(edgeSideAt(NaN, 400)).toBe(0);
  });
});

describe('cellAtPoint', () => {
  const grid = { gridLeft: 16, gridTop: 16, cols: 12, containerWidth: 1048, rowHeight: 100, gap: 16 };

  it('rounds to the nearest cell', () => {
    // Column pitch is (1048 - 176) / 12 + 16 = 88.67.
    expect(cellAtPoint({ ...grid, left: 16 + 89 * 3, top: 16 + 116 * 2 + 30, w: 4 })).toEqual({ x: 3, y: 2 });
  });

  it('keeps the widget on the grid', () => {
    expect(cellAtPoint({ ...grid, left: -500, top: -200, w: 4 })).toEqual({ x: 0, y: 0 });
    expect(cellAtPoint({ ...grid, left: 2000, top: 400, w: 4 })).toEqual({ x: 8, y: 3 });
  });
});

describe('findFreeSpot', () => {
  it('finds the first gap, then below everything', () => {
    const items = [{ i: 'a', x: 0, y: 0, w: 6, h: 2 }];
    expect(findFreeSpot(items, 6, 2, 12)).toEqual({ x: 6, y: 0 });
    expect(findFreeSpot([...items, { i: 'b', x: 6, y: 0, w: 6, h: 2 }], 6, 2, 12)).toEqual({ x: 0, y: 2 });
    expect(findFreeSpot([], 4, 2, 12)).toEqual({ x: 0, y: 0 });
  });
});

describe('placeAndPush', () => {
  it('pushes only what it lands on, cascading straight down', () => {
    const items = [
      { i: 'a', x: 0, y: 0, w: 6, h: 3 },
      { i: 'b', x: 0, y: 3, w: 6, h: 2 },
      { i: 'c', x: 6, y: 0, w: 6, h: 4 },
    ];
    const out = placeAndPush(items, { i: 'n', x: 0, y: 1, w: 4, h: 2 });
    expect(overlap(out)).toBe(null);
    const byId = Object.fromEntries(out.map((item) => [item.i, item]));
    expect(byId.n).toMatchObject({ x: 0, y: 1 });
    expect(byId.a).toMatchObject({ x: 0, y: 3 });
    expect(byId.b).toMatchObject({ x: 0, y: 6 });
    expect(byId.c).toMatchObject({ x: 6, y: 0 });
    expect(out.map((item) => item.i)).toEqual(['a', 'b', 'c', 'n']);
  });

  it('moves an existing widget in place, keeping the order', () => {
    const items = [{ i: 'a', x: 0, y: 0, w: 6, h: 2 }, { i: 'b', x: 6, y: 0, w: 6, h: 2 }];
    const out = placeAndPush(items, { i: 'a', x: 6, y: 0, w: 6, h: 2 });
    expect(out.map((item) => item.i)).toEqual(['a', 'b']);
    expect(out[1]).toMatchObject({ x: 6, y: 2 });
    expect(overlap(out)).toBe(null);
  });
});

describe('size presets', () => {
  it('counts the rows that fit on screen', () => {
    // 1920 tall, less 128 for padding and dock: 1792 + 16 over a 116 pitch.
    expect(visibleRows({ viewportHeight: 1920, rowHeight: 100, gap: 16 })).toBe(15);
    expect(visibleRows({ viewportHeight: 100, rowHeight: 100, gap: 16 })).toBe(2);
  });

  it('sizes small, medium, half and full screen, never under the minimum', () => {
    expect(sizeForPreset('small', { cols: 12, rows: 15 })).toEqual({ w: 4, h: 3 });
    expect(sizeForPreset('medium', { cols: 12, rows: 15 })).toEqual({ w: 6, h: 4 });
    expect(sizeForPreset('half', { cols: 12, rows: 15 })).toEqual({ w: 12, h: 7 });
    expect(sizeForPreset('full', { cols: 12, rows: 15 })).toEqual({ w: 12, h: 15 });
    expect(sizeForPreset('small', { cols: 12, rows: 6, minW: 5, minH: 2 })).toEqual({ w: 5, h: 2 });
    expect(sizeForPreset('huge', { cols: 12, rows: 6 })).toBe(null);
  });

  it('half screen starts at the left edge and pushes the rest down', () => {
    const items = [
      { i: 'a', x: 6, y: 0, w: 6, h: 3, minW: 2, minH: 2 },
      { i: 'b', x: 0, y: 0, w: 6, h: 3, minW: 2, minH: 2 },
    ];
    const out = applySizePreset(items, 'a', 'half', { cols: 12, rows: 15 });
    expect(out.find((item) => item.i === 'a')).toMatchObject({ x: 0, y: 0, w: 12, h: 7 });
    expect(out.find((item) => item.i === 'b')).toMatchObject({ x: 0, y: 7 });
    expect(overlap(out)).toBe(null);
  });

  it('a smaller preset keeps its place, shifted left only to stay on the grid', () => {
    const items = [{ i: 'a', x: 10, y: 2, w: 2, h: 2, minW: 1, minH: 1 }];
    expect(applySizePreset(items, 'a', 'medium', { cols: 12, rows: 15 })[0]).toMatchObject({ x: 6, y: 2, w: 6, h: 4 });
    expect(applySizePreset(items, 'missing', 'medium', { cols: 12, rows: 15 })).toBe(items);
  });
});

describe('placeArrival', () => {
  const items = [
    { i: 'a', x: 0, y: 0, w: 12, h: 3 },
    { i: 'new', x: 0, y: 3, w: 6, h: 4 },
  ];

  it('goes under the finger when dropped there', () => {
    const out = placeArrival(items, { i: 'new', w: 6, h: 2, cell: { x: 3, y: 1 }, cols: 12 });
    expect(out.find((item) => item.i === 'new')).toMatchObject({ x: 3, y: 1, w: 6, h: 2 });
    expect(out.find((item) => item.i === 'a')).toMatchObject({ y: 3 });
    expect(overlap(out)).toBe(null);
  });

  it('takes the first open spot otherwise, keeping its size', () => {
    const out = placeArrival(items, { i: 'new', w: 4, h: 2, cell: null, cols: 12 });
    expect(out.find((item) => item.i === 'new')).toMatchObject({ x: 0, y: 3, w: 4, h: 2 });
    expect(out.find((item) => item.i === 'a')).toMatchObject({ x: 0, y: 0 });
  });

  it('never leaves the grid', () => {
    const out = placeArrival(items, { i: 'new', w: 20, h: 2, cell: { x: 9, y: 0 }, cols: 12 });
    expect(out.find((item) => item.i === 'new')).toMatchObject({ x: 0, w: 12 });
  });
});
