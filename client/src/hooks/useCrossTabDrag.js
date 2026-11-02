import { useCallback, useEffect, useRef, useState } from 'react';
import { edgeSideAt } from '../utils/widgetTabMove.js';
import { swipeTargetTab } from '../utils/twoFingerSwipe.js';

// Carrying a widget to another tab while dragging it in Move/Resize mode,
// the way a phone moves an app to another home screen: hold it over a tab in
// the dock, or against the left or right edge of the screen, and the tab
// flips with the widget still under your finger.
//
// The grid (react-grid-layout) drags a widget within its own tab. This hook
// watches the pointer from the moment that drag starts; once a tab has to
// flip, it takes the drag over ("carry"): the grid is remounted, which ends
// its drag, and a copy of the widget follows the pointer on a layer of its
// own until it is let go. Pointer events are used, not touch events: they
// keep arriving after the touched element leaves the page (touch events
// stop), and the flip is exactly that.

export const HOVER_TAB_MS = 450;
export const EDGE_HOLD_MS = 650;
export const EDGE_REPEAT_MS = 950;

// The dock marks each tab button with data-dock-tab="<number>".
export function dockTabAtPoint(x, y, doc = document) {
  const element = typeof doc.elementFromPoint === 'function' ? doc.elementFromPoint(x, y) : null;
  const tabElement = element?.closest?.('[data-dock-tab]');
  if (!tabElement) return null;
  const number = Number.parseInt(tabElement.getAttribute('data-dock-tab'), 10);
  return Number.isFinite(number) ? number : null;
}

// A copy of the widget to carry: the same markup, minus what would load or
// run again (a plugin's frame, a video) or what belongs to the grid (the
// resize buttons, the drag cover).
function cloneForGhost(element) {
  const clone = element.cloneNode(true);
  clone.querySelectorAll('iframe, video, object, embed').forEach((node) => {
    const stand = document.createElement('div');
    stand.style.cssText = 'width:100%;height:100%;background:var(--card-bg);';
    node.replaceWith(stand);
  });
  clone.querySelectorAll('.resize-button, .drag-handle, .selection-overlay, .expand-controls').forEach((node) => {
    // A resize button sits in a positioned row of its own; take the row.
    (node.classList.contains('resize-button') ? node.parentElement : node)?.remove();
  });
  clone.removeAttribute('data-widget-id');
  clone.classList.remove('react-grid-item', 'react-draggable', 'react-draggable-dragging', 'cssTransforms', 'selected');
  Object.assign(clone.style, {
    position: 'relative',
    transform: 'none',
    left: '0',
    top: '0',
    width: '100%',
    height: '100%',
    margin: '0',
  });
  return clone;
}

export default function useCrossTabDrag({ enabled, tabs, activeTab, setActiveTab, onDrop }) {
  const [hoverTab, setHoverTab] = useState(null);
  const [edge, setEdge] = useState(0);
  // { widgetId, widgetName, fromTab, size, width, height, offsetX, offsetY, landing }
  const [carry, setCarry] = useState(null);
  const [pointer, setPointer] = useState(null);
  // Bumped to remount the grid, which ends its drag.
  const [gridEpoch, setGridEpoch] = useState(0);

  const watchRef = useRef(null);
  const ghostRef = useRef(null);
  const timersRef = useRef({ hover: null, edge: null });
  const tabsRef = useRef(tabs);
  const activeTabRef = useRef(activeTab);
  const onDropRef = useRef(onDrop);
  tabsRef.current = tabs;
  activeTabRef.current = activeTab;
  onDropRef.current = onDrop;

  const clearTimers = () => {
    clearTimeout(timersRef.current.hover);
    clearTimeout(timersRef.current.edge);
    timersRef.current = { hover: null, edge: null };
  };

  const stopWatching = useCallback(() => {
    const watch = watchRef.current;
    if (watch) watch.detach();
    watchRef.current = null;
    clearTimers();
    setHoverTab(null);
    setEdge(0);
  }, []);

  const flipTo = useCallback((tabNumber) => {
    const watch = watchRef.current;
    if (!watch || tabNumber == null || tabNumber === activeTabRef.current) return;
    if (!watch.carrying) {
      // Take the drag over from the grid.
      const rect = watch.element.getBoundingClientRect();
      ghostRef.current = cloneForGhost(watch.element);
      watch.carrying = true;
      watch.offsetX = watch.x - rect.left;
      watch.offsetY = watch.y - rect.top;
      setCarry({
        widgetId: watch.widgetId,
        widgetName: watch.widgetName,
        fromTab: watch.fromTab,
        size: watch.size,
        width: rect.width,
        height: rect.height,
        offsetX: watch.offsetX,
        offsetY: watch.offsetY,
        landing: false,
      });
      setPointer({ x: watch.x, y: watch.y });
      setGridEpoch((epoch) => epoch + 1);
    }
    setActiveTab(tabNumber);
  }, [setActiveTab]);

  const finish = useCallback(async (x, y) => {
    const watch = watchRef.current;
    stopWatching();
    if (!watch?.carrying) return;
    const overTab = dockTabAtPoint(x, y);
    const toTab = overTab ?? activeTabRef.current;
    setCarry((current) => (current ? { ...current, landing: true } : current));
    try {
      await onDropRef.current?.({
        widgetId: watch.widgetId,
        widgetName: watch.widgetName,
        fromTab: watch.fromTab,
        toTab,
        size: watch.size,
        // Where the widget's top-left corner was let go, unless it was let
        // go on a tab in the dock: then it takes the first open spot there.
        dropAt: overTab == null ? { left: x - watch.offsetX, top: y - watch.offsetY } : null,
      });
    } finally {
      ghostRef.current = null;
      setCarry(null);
      setPointer(null);
    }
  }, [stopWatching]);

  const cancel = useCallback(() => {
    const watch = watchRef.current;
    stopWatching();
    if (watch?.carrying) {
      ghostRef.current = null;
      setCarry(null);
      setPointer(null);
      setActiveTab(watch.fromTab);
    }
  }, [setActiveTab, stopWatching]);

  // Called by the grid when one of its widgets starts being dragged.
  const beginWatch = useCallback(({ widgetId, widgetName, element, size, x, y }) => {
    if (!enabled || !element || watchRef.current) return;
    const watch = {
      widgetId,
      widgetName,
      element,
      size,
      fromTab: activeTabRef.current,
      x: x ?? 0,
      y: y ?? 0,
      offsetX: 0,
      offsetY: 0,
      carrying: false,
      hover: null,
      edge: 0,
    };

    const armEdge = (side) => {
      clearTimeout(timersRef.current.edge);
      if (!side) return;
      const fire = (delay) => {
        timersRef.current.edge = setTimeout(() => {
          if (!watchRef.current || watchRef.current.edge !== side) return;
          flipTo(swipeTargetTab(tabsRef.current, activeTabRef.current, side));
          fire(EDGE_REPEAT_MS);
        }, delay);
      };
      fire(EDGE_HOLD_MS);
    };

    const onMove = (event) => {
      if (!event.isPrimary) return;
      watch.x = event.clientX;
      watch.y = event.clientY;
      if (watch.carrying) setPointer({ x: event.clientX, y: event.clientY });

      const overTab = dockTabAtPoint(event.clientX, event.clientY);
      const target = overTab != null && overTab !== activeTabRef.current ? overTab : null;
      if (target !== watch.hover) {
        watch.hover = target;
        setHoverTab(target);
        clearTimeout(timersRef.current.hover);
        if (target != null) {
          timersRef.current.hover = setTimeout(() => {
            if (watchRef.current?.hover === target) flipTo(target);
          }, HOVER_TAB_MS);
        }
      }

      const side = overTab == null ? edgeSideAt(event.clientX, window.innerWidth) : 0;
      if (side !== watch.edge) {
        watch.edge = side;
        setEdge(side);
        armEdge(side);
      }
    };
    const onUp = (event) => {
      if (!event.isPrimary) return;
      if (watch.carrying) {
        void finish(event.clientX, event.clientY);
      } else {
        stopWatching();
      }
    };
    const onCancel = (event) => {
      if (event.isPrimary) cancel();
    };
    const onKey = (event) => {
      if (event.key === 'Escape') cancel();
    };

    window.addEventListener('pointermove', onMove, { capture: true, passive: true });
    window.addEventListener('pointerup', onUp, { capture: true });
    window.addEventListener('pointercancel', onCancel, { capture: true });
    window.addEventListener('keydown', onKey);
    watch.detach = () => {
      window.removeEventListener('pointermove', onMove, { capture: true });
      window.removeEventListener('pointerup', onUp, { capture: true });
      window.removeEventListener('pointercancel', onCancel, { capture: true });
      window.removeEventListener('keydown', onKey);
    };
    watchRef.current = watch;
  }, [enabled, flipTo, finish, cancel, stopWatching]);

  // The grid's drag ended on its own (let go without flipping a tab).
  const endWatch = useCallback(() => {
    if (watchRef.current && !watchRef.current.carrying) stopWatching();
  }, [stopWatching]);

  // Leaving Move/Resize mode ends any drag in progress.
  useEffect(() => {
    if (!enabled) cancel();
  }, [enabled, cancel]);

  useEffect(() => () => {
    watchRef.current?.detach?.();
    clearTimeout(timersRef.current.hover);
    clearTimeout(timersRef.current.edge);
  }, []);

  return {
    beginWatch,
    endWatch,
    hoverTab,
    edge: carry || watchRef.current ? edge : 0,
    carry,
    pointer,
    ghostRef,
    gridEpoch,
    // The carried widget, hidden where it still sits until it lands.
    hiddenWidgetId: carry && activeTab === carry.fromTab ? carry.widgetId : null,
  };
}
