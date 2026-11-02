import { describe, expect, it } from 'vitest';
import {
  decideMode,
  findOverlaps,
  firstOpenSpot,
  isScheduleActive,
  minuteOfWeek,
  normalizeModesSettings,
  placeModeLayout,
  scheduledModeAt,
  scheduleSpans,
  staleModeTabs,
  visibleGridRows,
} from './displayModes.js';

const at = (iso) => new Date(iso);
const morning = { id: 'm', name: 'Morning', schedule: { days: [1, 2, 3, 4, 5], start: '06:00', end: '09:00' } };
const overnight = { id: 'o', name: 'Overnight', schedule: { days: [0, 1, 2, 3, 4, 5, 6], start: '22:00', end: '06:00' } };

describe('normalizeModesSettings', () => {
  it('fills defaults and drops broken modes and duplicate ids', () => {
    const out = normalizeModesSettings({
      modes: [morning, { id: 'm', name: 'Again' }, { id: 'x' }, null, { id: 'y', name: '  Night ', schedule: { days: [], start: '1', end: '2' } }],
      touchWaitSeconds: 'abc',
      returnMinutes: 9999,
    });
    expect(out.modes.map((m) => m.id)).toEqual(['m', 'y']);
    expect(out.modes[1].name).toBe('Night');
    expect(out.modes[1].schedule).toBeNull();
    expect(out.touchWaitSeconds).toBe(60);
    expect(out.returnMinutes).toBe(120);
    expect(out.showLabel).toBe(true);
  });

  it('keeps only whole layout items', () => {
    const out = normalizeModesSettings({ modes: [{ id: 'a', name: 'A', layouts: { 1: { calendar: { x: 0, y: 0, w: 6, h: 4 }, bad: { x: 0 } }, nope: {} } }] });
    expect(out.modes[0].layouts).toEqual({ 1: { calendar: { x: 0, y: 0, w: 6, h: 4 } } });
  });
});

describe('schedules', () => {
  it('reads the time in the household zone', () => {
    // 2026-11-02 is a Monday. 12:30 UTC is 06:30 in Chicago.
    expect(minuteOfWeek(at('2026-11-02T12:30:00Z'), 'America/Chicago')).toBe(1 * 1440 + 6 * 60 + 30);
  });

  it('is on from start, off at end', () => {
    expect(isScheduleActive(morning.schedule, at('2026-11-02T12:00:00Z'), 'America/Chicago')).toBe(true);
    expect(isScheduleActive(morning.schedule, at('2026-11-02T15:00:00Z'), 'America/Chicago')).toBe(false);
    expect(isScheduleActive(morning.schedule, at('2026-11-02T11:59:00Z'), 'America/Chicago')).toBe(false);
  });

  it('runs past midnight, and past Saturday into Sunday', () => {
    const sat = { days: [6], start: '22:00', end: '02:00' };
    expect(scheduleSpans(sat)).toEqual([[6 * 1440 + 1320, 10080], [0, 120]]);
    // Sunday 01:00 Chicago.
    expect(isScheduleActive(sat, at('2026-11-08T07:00:00Z'), 'America/Chicago')).toBe(true);
  });

  it('picks the scheduled mode or none', () => {
    expect(scheduledModeAt([morning, overnight], at('2026-11-02T12:00:00Z'), 'America/Chicago')).toBe('m');
    expect(scheduledModeAt([morning, overnight], at('2026-11-02T20:00:00Z'), 'America/Chicago')).toBeNull();
  });

  it('finds overlaps, not schedules that only touch', () => {
    expect(findOverlaps([morning, overnight])).toEqual([]);
    const early = { ...morning, schedule: { ...morning.schedule, start: '05:30' } };
    const found = findOverlaps([early, overnight]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ a: 'm', b: 'o', from: 1440 + 330, to: 1440 + 360 });
  });
});

describe('decideMode', () => {
  const base = { scheduledId: 'm', pin: null, shownId: null, lastActivityMs: 0, nowMs: 100000, touchWaitMs: 60000 };

  it('follows the schedule', () => {
    expect(decideMode(base)).toEqual({ want: 'm', pinExpired: false, show: 'm' });
  });

  it('waits while the screen was touched recently', () => {
    expect(decideMode({ ...base, lastActivityMs: 90000 }).show).toBeNull();
  });

  it('holds a pin until the schedule changes', () => {
    const pin = { modeId: 'n', scheduledAtPin: 'm' };
    expect(decideMode({ ...base, pin, shownId: 'n' })).toEqual({ want: 'n', pinExpired: false, show: 'n' });
    expect(decideMode({ ...base, pin, shownId: 'n', scheduledId: null })).toEqual({ want: null, pinExpired: true, show: null });
  });

  it('a pin to the normal layout is a pin too', () => {
    expect(decideMode({ ...base, pin: { modeId: null, scheduledAtPin: 'm' } }).show).toBeNull();
  });
});

describe('placeModeLayout', () => {
  const saved = { weather: { x: 0, y: 0, w: 12, h: 3 }, calendar: { x: 0, y: 3, w: 6, h: 4 } };

  it('keeps the snapshot and puts a newcomer in the first open spot', () => {
    const out = placeModeLayout({
      saved,
      widgets: [{ name: 'weather' }, { name: 'calendar' }, { name: 'music', size: { w: 6, h: 2 } }],
      rows: 10,
    });
    expect(out.placed.weather).toEqual(saved.weather);
    expect(out.placed.music).toEqual({ x: 6, y: 3, w: 6, h: 2 });
    expect(out.added).toEqual(['music']);
    expect(out.hidden).toEqual([]);
  });

  it('hides a newcomer with no room on screen', () => {
    const out = placeModeLayout({
      saved,
      widgets: [{ name: 'weather' }, { name: 'calendar' }, { name: 'big', size: { w: 12, h: 4 } }],
      rows: 8,
    });
    expect(out.hidden).toEqual(['big']);
    expect(out.placed.big).toBeUndefined();
  });

  it('drops widgets turned off on this display', () => {
    const out = placeModeLayout({ saved, widgets: [{ name: 'calendar' }], available: new Set(['calendar']), rows: 10 });
    expect(Object.keys(out.placed)).toEqual(['calendar']);
  });
});

describe('helpers', () => {
  it('firstOpenSpot with no row limit goes below everything', () => {
    expect(firstOpenSpot({ w: 12, h: 2 }, [{ x: 0, y: 0, w: 12, h: 3 }])).toEqual({ x: 0, y: 3, w: 12, h: 2 });
  });

  it('staleModeTabs lists widgets missing from saved layouts', () => {
    const mode = { layouts: { 1: { calendar: { x: 0, y: 0, w: 1, h: 1 } } } };
    expect(staleModeTabs(mode, { 1: ['calendar', 'music'], 2: ['weather'] })).toEqual({ 1: ['music'] });
  });

  it('visibleGridRows counts whole rows above the dock', () => {
    expect(visibleGridRows(2560, { rowHeight: 100, gap: 16 })).toBe(21);
  });
});

describe('mode layout drafts', () => {
  it('starts from the tab when the mode has no layout for it', async () => {
    const { startDraft } = await import('./displayModes.js');
    const draft = startDraft({ layouts: {} }, 1, [
      { name: 'calendar', layout: { x: 0, y: 0, w: 6, h: 4 } },
      { name: 'music', layout: null },
    ]);
    expect(draft.saved.calendar).toEqual({ x: 0, y: 0, w: 6, h: 4 });
    expect(draft.saved.music).toEqual({ x: 6, y: 0, w: 4, h: 3 });
    expect(draft.hidden).toEqual([]);
  });

  it('starts from the mode when it has a layout', async () => {
    const { startDraft } = await import('./displayModes.js');
    const mode = { layouts: { 1: { weather: { x: 0, y: 0, w: 12, h: 3 } } }, hidden: { 1: ['chores'] } };
    expect(startDraft(mode, 1, [])).toEqual({ saved: { weather: { x: 0, y: 0, w: 12, h: 3 } }, hidden: ['chores'] });
    // A widget added to the tab since shows in the first open spot.
    const withNew = startDraft(mode, 1, [{ name: 'chores', layout: null }, { name: 'music', layout: { x: 0, y: 0, w: 6, h: 2 } }]);
    expect(withNew.saved.music).toEqual({ x: 0, y: 3, w: 6, h: 2 });
    expect(withNew.saved.chores).toBeUndefined();
  });

  it('hides and shows widgets', async () => {
    const { hideInDraft, showInDraft } = await import('./displayModes.js');
    let draft = { saved: { weather: { x: 0, y: 0, w: 12, h: 3 }, chores: { x: 0, y: 3, w: 6, h: 4 } }, hidden: [] };
    draft = hideInDraft(draft, 'chores', true);
    expect(draft).toEqual({ saved: { weather: { x: 0, y: 0, w: 12, h: 3 } }, hidden: ['chores'] });
    draft = showInDraft(draft, 'chores', { w: 6, h: 4 });
    expect(draft.hidden).toEqual([]);
    expect(draft.saved.chores).toEqual({ x: 0, y: 3, w: 6, h: 4 });
    // A widget from another tab isn't remembered as hidden.
    expect(hideInDraft(draft, 'grill', false).hidden).toEqual([]);
  });

  it('placeModeLayout skips hidden widgets and brings in ones from other tabs', () => {
    const out = placeModeLayout({
      saved: { weather: { x: 0, y: 0, w: 12, h: 3 }, grill: { x: 0, y: 3, w: 6, h: 4 }, gone: { x: 6, y: 3, w: 6, h: 4 } },
      widgets: [{ name: 'weather' }, { name: 'chores' }],
      hiddenNames: ['chores'],
      available: new Set(['weather', 'chores', 'grill']),
      rows: 20,
    });
    expect(Object.keys(out.placed).sort()).toEqual(['grill', 'weather']);
    expect(out.added).toEqual([]);
    expect(out.hidden).toEqual([]);
  });
});
