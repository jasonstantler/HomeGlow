import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box } from '@mui/material';

// Hold a dragged widget over a tab in the dock, or at the side of the screen,
// this long and that tab opens with the widget still in hand.
export const CARRY_DWELL_MS = 500;
// How close to the left or right of the screen counts as "the side".
export const EDGE_PX = 48;
const PITCH_PX = 116; // utils/gridMetrics.js GRID_PITCH: a row plus its gap

const pointOf = (event) => {
  const touch = event?.changedTouches?.[0] || event?.touches?.[0];
  if (touch) return { x: touch.clientX, y: touch.clientY };
  if (event && Number.isFinite(event.clientX)) return { x: event.clientX, y: event.clientY };
  return null;
};

// The free spot closest to `want`, among the rows down to just below
// everything already there.
export function nearestFreeCell(want, others) {
  const bottom = Math.max(want.y, ...others.map((item) => item.y + item.h));
  let best = null;
  let bestDistance = Infinity;
  for (let y = 0; y <= bottom; y += 1) {
    for (let x = 0; x + want.w <= 12; x += 1) {
      const candidate = { x, y, w: want.w, h: want.h };
      if (others.some((item) => overlaps(item, candidate))) continue;
      const distance = Math.hypot(x - want.x, (y - want.y) * 1.5);
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
  }
  return best;
}

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Carrying a widget to another tab while dragging it (Move/Resize and the mode
 * layout editor). Hovering a tab in the dock, or the left or right side of the
 * screen, opens that tab; the widget then follows the finger as a card and is
 * placed where it's let go. Letting go over a tab in the dock without waiting
 * still sends it there.
 *
 * - tabs, activeTab, setTab(number)
 * - dockTargetAt(x, y): the tab number under a point in the dock, 'add' for
 *   the + button, or null
 * - sizeOf(name): the widget's size in grid units, { w, h }
 * - placedOn(): the active tab's widgets as { name: {x,y,w,h} }, to keep a
 *   drop clear of them
 * - gridRoot(): the element holding the grid (to turn a point into a cell)
 * - scale: how much the grid is shown scaled
 * - onDrop({ name, fromTab, toTab, cell }): put it there; cell is {x,y,w,h},
 *   or null for "anywhere it fits"
 * - onDropAdd({ name, fromTab }): let go over the + button
 *
 * Returns { carrying, hoverTarget, carryKey, onDrag, onDragStop, ghost }.
 * While `carrying` is set, leave that widget out of the grid; remount the grid
 * when `carryKey` changes (the drag it began in is over).
 */
export default function useCarryToTab({
  tabs,
  activeTab,
  setTab,
  dockTargetAt,
  sizeOf,
  placedOn,
  gridRoot,
  scale = 1,
  onDrop,
  onDropAdd,
}) {
  const [carrying, setCarrying] = useState(null);
  const [hoverTarget, setHoverTarget] = useState(null);
  const [ghostAt, setGhostAt] = useState(null);
  const [carryKey, setCarryKey] = useState(0);
  const dwellRef = useRef({ target: null, since: 0 });
  const live = useRef({});
  live.current = { tabs, activeTab, setTab, dockTargetAt, sizeOf, placedOn, gridRoot, scale, onDrop, onDropAdd, carrying };

  // What a point is over: a tab in the dock, the + button, or a side of the
  // screen (the tab before or after the open one).
  const targetAt = useCallback((x, y) => {
    const { dockTargetAt: dock, tabs: list, activeTab: current } = live.current;
    const overDock = dock(x, y);
    if (overDock != null) return { target: overDock, edge: false };
    const numbers = list.map((tab) => tab.number);
    const index = numbers.indexOf(current);
    if (x <= EDGE_PX && index > 0) return { target: numbers[index - 1], edge: true };
    if (x >= window.innerWidth - EDGE_PX && index >= 0 && index < numbers.length - 1) return { target: numbers[index + 1], edge: true };
    return { target: null, edge: false };
  }, []);

  // Open the tab once the pointer has stayed on it long enough. Returns the
  // tab opened, or null.
  const dwell = useCallback((target) => {
    const now = Date.now();
    const { activeTab: current } = live.current;
    if (!Number.isInteger(target) || target === current) {
      dwellRef.current = { target: null, since: 0 };
      return null;
    }
    if (dwellRef.current.target !== target) {
      dwellRef.current = { target, since: now };
      return null;
    }
    if (now - dwellRef.current.since < CARRY_DWELL_MS) return null;
    dwellRef.current = { target: null, since: 0 };
    live.current.setTab(target);
    return target;
  }, []);

  // A drag in the grid: a pause over a tab or a side starts carrying.
  const onDrag = useCallback((name, x, y) => {
    if (!name || live.current.carrying) return;
    const { target } = targetAt(x, y);
    setHoverTarget((current) => (current === target ? current : target));
    const fromTab = live.current.activeTab;
    const opened = dwell(target);
    if (opened == null) return;
    const el = document.querySelector(`[data-widget-name="${CSS.escape(name)}"]`);
    const rect = el?.getBoundingClientRect();
    const size = live.current.sizeOf(name) || { w: 4, h: 3 };
    const width = rect?.width || 300;
    const height = rect?.height || 200;
    const grab = rect ? { x: x - rect.left, y: y - rect.top } : { x: width / 2, y: 24 };
    setCarrying({ name, fromTab, size, width, height, grab });
    setGhostAt({ x, y });
    setCarryKey((key) => key + 1);
  }, [targetAt, dwell]);

  // Let go in the grid: over a tab in the dock, it goes there at once.
  // Returns true when the widget left this tab, so the grid doesn't save the
  // drag's last position for it.
  const onDragStop = useCallback((name, x, y) => {
    dwellRef.current = { target: null, since: 0 };
    setHoverTarget(null);
    if (!name || live.current.carrying) return false;
    const target = live.current.dockTargetAt(x, y);
    const fromTab = live.current.activeTab;
    if (target === 'add') {
      live.current.onDropAdd?.({ name, fromTab });
      return false;
    }
    if (Number.isInteger(target) && target !== fromTab) {
      live.current.onDrop({ name, fromTab, toTab: target, cell: null });
      return true;
    }
    return false;
  }, []);

  // The cell under the card's top-left corner on the open tab, or null when
  // the tab has no grid or the spot is taken.
  const cellAt = useCallback((x, y, carry) => {
    const root = live.current.gridRoot?.();
    const grid = root?.querySelector?.('.react-grid-layout');
    if (!grid) return null;
    const r = grid.getBoundingClientRect();
    const s = live.current.scale || 1;
    const colWidth = r.width / 12;
    const left = x - carry.grab.x - r.left;
    const top = y - carry.grab.y - r.top;
    const w = Math.min(12, carry.size.w);
    const cell = {
      x: Math.min(12 - w, Math.max(0, Math.round(left / colWidth))),
      y: Math.max(0, Math.round(top / (PITCH_PX * s))),
      w,
      h: carry.size.h,
    };
    const others = Object.entries(live.current.placedOn() || {})
      .filter(([other]) => other !== carry.name)
      .map(([, item]) => item);
    return nearestFreeCell(cell, others);
  }, []);

  // While carrying: the card follows the pointer, pauses switch tabs, and
  // letting go places the widget.
  useEffect(() => {
    if (!carrying) return undefined;
    const move = (event) => {
      const point = pointOf(event);
      if (!point) return;
      setGhostAt(point);
      const { target } = targetAt(point.x, point.y);
      setHoverTarget((current) => (current === target ? current : target));
      dwell(target);
    };
    const finish = (event) => {
      const point = pointOf(event) || { x: -1, y: -1 };
      const carry = live.current.carrying;
      setCarrying(null);
      setGhostAt(null);
      setHoverTarget(null);
      dwellRef.current = { target: null, since: 0 };
      if (!carry) return;
      const over = live.current.dockTargetAt(point.x, point.y);
      if (over === 'add') {
        live.current.onDropAdd?.({ name: carry.name, fromTab: carry.fromTab });
        return;
      }
      const toTab = Number.isInteger(over) ? over : live.current.activeTab;
      const cell = Number.isInteger(over) ? null : cellAt(point.x, point.y, carry);
      live.current.onDrop({ name: carry.name, fromTab: carry.fromTab, toTab, cell });
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('touchmove', move, true);
    window.addEventListener('pointerup', finish, true);
    window.addEventListener('pointercancel', finish, true);
    window.addEventListener('touchend', finish, true);
    window.addEventListener('mouseup', finish, true);
    return () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('touchmove', move, true);
      window.removeEventListener('pointerup', finish, true);
      window.removeEventListener('pointercancel', finish, true);
      window.removeEventListener('touchend', finish, true);
      window.removeEventListener('mouseup', finish, true);
    };
  }, [carrying, targetAt, dwell, cellAt]);

  const ghost = carrying && ghostAt ? (
    <Box
      aria-hidden="true"
      sx={{
        position: 'fixed',
        left: ghostAt.x - carrying.grab.x,
        top: ghostAt.y - carrying.grab.y,
        width: carrying.width,
        height: carrying.height,
        zIndex: 20000,
        pointerEvents: 'none',
        borderRadius: 'var(--hg-frame-radius, 12px)',
        border: '3px solid var(--accent)',
        backgroundColor: 'rgba(var(--accent-rgb), 0.12)',
        boxShadow: '0 16px 48px var(--hg-black-30)',
      }}
    />
  ) : null;

  return { carrying, hoverTarget, carryKey, onDrag, onDragStop, ghost };
}
