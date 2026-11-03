import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  Divider,
  ListSubheader,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import WidgetContainer from './WidgetContainer.jsx';
import { TabIcon } from './TabBar.jsx';
import useCarryToTab from '../hooks/useCarryToTab.jsx';
import {
  hideInDraft,
  showInDraft,
  startDraft,
  visibleGridRows,
} from '../utils/displayModes.js';
import { readGridMetrics } from '../utils/gridMetrics.js';

// How big the preview is next to the real wall.
const PREVIEW_SCALE = 0.85;
// Holding a widget this long, without moving, opens its options.
const LONG_PRESS_MS = 550;
const LONG_PRESS_SLOP_PX = 10;
// The grid saves a moved widget after this long (WidgetContainer); Save waits
// a little longer so the last move is in.
const SETTLE_MS = 650;

/**
 * Admin → Displays → Modes: a mode's layout, edited on a smaller copy of the
 * dashboard with the real widgets in it. Moves, resizes and hiding go into the
 * mode only; the display's usual layout is never touched. Save stores every
 * tab you changed; Cancel drops them.
 *
 * - mode: the mode being edited
 * - tabs: this display's tabs; startTab: the one to open on
 * - widgets: [{ name, label? }] turned on here (core widgets are named for you)
 * - tabWidgets(tab): [{ name, layout }] on that tab normally
 * - sizeOf(name): a widget's usual size, { w, h }
 * - buildWidgets(tab, saved): the grid's widgets for a draft's layout
 * - onSave(drafts): { tab: { saved, hidden } }; onClose()
 */
const ModeLayoutEditor = ({ mode, tabs, startTab, widgets, tabWidgets, sizeOf, buildWidgets, onSave, onClose }) => {
  const { t } = useTranslation(['common', 'admin']);
  const labelOf = (widget) => widget.label || t(`admin:screensaver.expand.widgetNames.${widget.name}`, { defaultValue: widget.name });
  const [tab, setTab] = useState(startTab || tabs[0]?.number || 1);
  const [drafts, setDrafts] = useState({});
  const [menuAnchor, setMenuAnchor] = useState(null);
  const [saving, setSaving] = useState(false);
  // The long-press menu: { name, x, y } of the widget held.
  const [widgetMenu, setWidgetMenu] = useState(null);
  const pressRef = useRef(null);
  // The preview's full height, so a tall tab scrolls in the editor.
  const contentRef = useRef(null);
  const [contentHeight, setContentHeight] = useState(window.innerHeight);
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;

  const viewport = useMemo(() => ({ width: window.innerWidth, height: window.innerHeight }), []);
  const rows = useMemo(() => visibleGridRows(viewport.height, readGridMetrics()), [viewport.height]);

  const onTabNames = useMemo(() => new Set(tabWidgets(tab).map((item) => item.name)), [tab, tabWidgets]);
  const draft = drafts[tab] || startDraft(mode, tab, tabWidgets(tab));
  const setDraft = (next) => setDrafts((prev) => ({ ...prev, [tab]: next }));

  // Start each tab's draft the first time it's opened, so its widgets keep
  // their place even before anything moves.
  useEffect(() => {
    setDrafts((prev) => (prev[tab] ? prev : { ...prev, [tab]: startDraft(mode, tab, tabWidgets(tab)) }));
  }, [tab, mode, tabWidgets]);

  // ---- The dock: tap a tab to edit it; drag a widget onto a tab, or hold it
  // over a tab or at the side of the screen to open that tab with it in hand.
  const editorTabAt = (x, y) => {
    const el = [...document.querySelectorAll('[data-editor-tab]')].find((item) => {
      const r = item.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    });
    return el ? Number(el.getAttribute('data-editor-tab')) : null;
  };
  const carry = useCarryToTab({
    tabs,
    activeTab: tab,
    setTab,
    dockTargetAt: editorTabAt,
    sizeOf: (name) => draft.saved[name] || sizeOf(name),
    placedOn: () => draft.saved,
    gridRoot: () => contentRef.current,
    scale: PREVIEW_SCALE,
    onDrop: ({ name, fromTab, toTab, cell }) => {
      moveToTab(name, fromTab, toTab, cell);
      setTab(toTab);
    },
  });
  const dropTab = carry.hoverTarget;

  const carriedName = carry.carrying?.name || null;
  const grid = useMemo(() => {
    if (!carriedName || !draft.saved[carriedName]) return buildWidgets(tab, draft.saved);
    const { [carriedName]: _carried, ...rest } = draft.saved;
    return buildWidgets(tab, rest);
  }, [buildWidgets, tab, draft.saved, carriedName]);

  const saveFromGrid = (layoutRows, tabNumber) => {
    setDrafts((prev) => {
      const current = prev[tabNumber] || startDraft(mode, tabNumber, tabWidgets(tabNumber));
      const saved = { ...current.saved };
      // Only widgets still on this tab: one just moved to another tab (or
      // hidden) may still be in the grid's last save.
      layoutRows.forEach((row) => {
        if (!saved[row.widget_name]) return;
        saved[row.widget_name] = { x: row.layout_x, y: row.layout_y, w: row.layout_w, h: row.layout_h };
      });
      return { ...prev, [tabNumber]: { ...current, saved } };
    });
  };

  const toggle = (name) => {
    if (draft.saved[name]) setDraft(hideInDraft(draft, name, onTabNames.has(name)));
    else setDraft(showInDraft(draft, name, sizeOf(name), rows));
  };

  useEffect(() => {
    const el = contentRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => setContentHeight(Math.max(viewport.height, el.scrollHeight)));
    observer.observe(el);
    const grid = el.firstElementChild;
    if (grid) observer.observe(grid);
    return () => observer.disconnect();
  }, [viewport.height, tab, grid.length]);

  // ---- Long press on a widget: its options ----
  const cancelPress = () => {
    if (pressRef.current) clearTimeout(pressRef.current.timer);
    pressRef.current = null;
  };
  const onPressStart = (event) => {
    const el = event.target?.closest?.('[data-widget-name]');
    // A selected widget is for dragging: holding it before moving mustn't
    // open the menu.
    if (!el || event.target.closest('.drag-handle')) return;
    const name = el.getAttribute('data-widget-name');
    const start = { x: event.clientX, y: event.clientY };
    cancelPress();
    pressRef.current = {
      start,
      timer: setTimeout(() => {
        pressRef.current = null;
        setWidgetMenu({ name, x: start.x, y: start.y });
      }, LONG_PRESS_MS),
    };
  };
  const onPressMove = (event) => {
    const press = pressRef.current;
    if (!press) return;
    if (Math.hypot(event.clientX - press.start.x, event.clientY - press.start.y) > LONG_PRESS_SLOP_PX) cancelPress();
  };
  useEffect(() => cancelPress, []);

  // Move a widget from one tab to another in this mode; `cell` is where on
  // the tab ({x,y,w,h}), or null for the first open spot.
  const moveToTab = (name, fromTab, toTab, cell = null) => {
    setDrafts((prev) => {
      const here = prev[fromTab] || startDraft(mode, fromTab, tabWidgets(fromTab));
      const item = here.saved[name];
      const size = item ? { w: item.w, h: item.h } : sizeOf(name);
      if (fromTab === toTab) {
        return cell ? { ...prev, [toTab]: { ...here, saved: { ...here.saved, [name]: cell } } } : prev;
      }
      const isOnTab = tabWidgets(fromTab).some((widget) => widget.name === name);
      const there = showInDraft(prev[toTab] || startDraft(mode, toTab, tabWidgets(toTab)), name, size, rows);
      if (cell) there.saved = { ...there.saved, [name]: cell };
      return { ...prev, [fromTab]: hideInDraft(here, name, isOnTab), [toTab]: there };
    });
  };


  const menuWidget = widgetMenu && widgets.find((widget) => widget.name === widgetMenu.name);
  const closeWidgetMenu = () => setWidgetMenu(null);
  const pick = (fn) => () => {
    const { name } = widgetMenu;
    closeWidgetMenu();
    fn(name);
  };

  const save = async () => {
    setSaving(true);
    await new Promise((resolve) => { setTimeout(resolve, SETTLE_MS); });
    try {
      await onSave(draftsRef.current);
      onClose();
    } catch (error) {
      console.error('Error saving the mode layout:', error);
      setSaving(false);
    }
  };

  const shown = widgets.filter((widget) => draft.saved[widget.name]).length;

  return (
    <Dialog
      open
      fullScreen
      onClose={onClose}
      aria-label={t('modes.editor.title', { name: mode.name })}
      slotProps={{ paper: { sx: { background: 'var(--container-background-override)', display: 'flex', flexDirection: 'column' } } }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 1.5,
          px: 2,
          py: 1.25,
          borderBottom: '1px solid var(--card-border)',
          backgroundColor: 'var(--card-bg)',
          color: 'var(--text)',
          flex: 'none',
        }}
      >
        <Box sx={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: mode.color, flex: 'none' }} />
        <Box sx={{ mr: 'auto', minWidth: 0 }}>
          <Typography sx={{ fontWeight: 700, lineHeight: 1.2 }}>{t('modes.editor.title', { name: mode.name })}</Typography>
          <Typography variant="body2" sx={{ color: 'var(--text-secondary)' }}>{t('modes.editor.help')}</Typography>
        </Box>
        <Button variant="outlined" onClick={(e) => setMenuAnchor(e.currentTarget)} aria-haspopup="menu">
          {t('modes.editor.widgets', { count: shown })}
        </Button>
        <Button onClick={onClose} disabled={saving}>{t('modes.editor.cancel')}</Button>
        <Button variant="contained" onClick={save} disabled={saving}>
          {saving ? t('modes.editor.saving') : t('modes.editor.save')}
        </Button>
        <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
          {widgets.map((widget) => (
            <MenuItem key={widget.name} onClick={() => toggle(widget.name)}>
              <ListItemIcon>
                <Checkbox edge="start" checked={Boolean(draft.saved[widget.name])} tabIndex={-1} disableRipple />
              </ListItemIcon>
              <ListItemText
                primary={labelOf(widget)}
                secondary={onTabNames.has(widget.name) ? null : t('modes.editor.fromOtherTab')}
              />
            </MenuItem>
          ))}
        </Menu>
      </Box>

      <Box sx={{ flex: 1, overflow: 'auto', pt: 3, pb: 12, display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}>
        <Box
          onPointerDownCapture={onPressStart}
          onPointerMoveCapture={onPressMove}
          onPointerUpCapture={cancelPress}
          onPointerCancelCapture={cancelPress}
          onContextMenu={(e) => e.preventDefault()}
          sx={{
            width: viewport.width * PREVIEW_SCALE,
            height: contentHeight * PREVIEW_SCALE,
            flex: 'none',
            position: 'relative',
            overflow: 'hidden',
            borderRadius: 'var(--hg-radius-lg)',
            border: '2px solid var(--card-border)',
            boxShadow: 'var(--shadow)',
            background: 'var(--container-background-override)',
          }}
        >
          <Box
            ref={contentRef}
            sx={{
              width: viewport.width,
              minHeight: viewport.height,
              transform: `scale(${PREVIEW_SCALE})`,
              transformOrigin: 'top left',
              // The dashboard keeps this much clear above the dock.
              pb: '80px',
              boxSizing: 'border-box',
            }}
          >
            {grid.length > 0 ? (
              <WidgetContainer
                key={`${tab}-${carry.carryKey}`}
                widgets={grid}
                locked={false}
                activeTab={tab}
                activeTabId={tabs.find((item) => item.number === tab)?.id ?? tab}
                scale={PREVIEW_SCALE}
                onSaveLayouts={saveFromGrid}
                onWidgetDrag={carry.onDrag}
                onWidgetDragStop={carry.onDragStop}
              />
            ) : (
              <Typography sx={{ p: 6, textAlign: 'center', color: 'var(--text-secondary)' }}>
                {t('modes.editor.empty')}
              </Typography>
            )}
          </Box>
        </Box>
      </Box>
      <Box
        role="tablist"
        aria-label={t('modes.editor.tabs')}
        sx={{
          position: 'fixed',
          bottom: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 2,
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          px: 2,
          py: 1,
          borderRadius: 'var(--hg-radius-2xl)',
          backgroundColor: 'var(--dock-bg)',
          border: '1px solid var(--dock-border)',
          backdropFilter: 'blur(20px)',
          boxShadow: '0 8px 32px var(--hg-black-30), 0 2px 8px var(--hg-black-20)',
        }}
      >
        {tabs.map((item) => {
          const active = item.number === tab;
          const dropping = dropTab === item.number && !active;
          const hasLayout = Boolean(drafts[item.number] || mode.layouts?.[item.number]);
          return (
            <Box
              key={item.number}
              component="button"
              type="button"
              role="tab"
              aria-selected={active}
              aria-label={item.label || t('modes.editor.tabNumber', { number: item.number })}
              data-editor-tab={item.number}
              onClick={() => setTab(item.number)}
              sx={{
                width: 44,
                height: 44,
                p: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
                cursor: 'pointer',
                borderRadius: 'var(--hg-radius-lg)',
                transition: 'all 0.2s ease',
                backgroundColor: active ? 'var(--dock-active-bg)' : 'transparent',
                backgroundImage: active ? 'var(--dock-active-image)' : 'none',
                border: active ? '1.5px solid var(--dock-active-border)' : '1.5px solid transparent',
                ...(dropping && {
                  transform: 'scale(1.15)',
                  border: '1.5px solid var(--accent)',
                  backgroundColor: 'rgba(var(--accent-rgb), 0.18)',
                }),
              }}
            >
              <TabIcon name={item.icon} size={22} color={active ? 'var(--dock-active-icon)' : 'var(--dock-icon)'} />
              {hasLayout && (
                <Box
                  aria-hidden="true"
                  sx={{ position: 'absolute', top: 3, right: 3, width: 7, height: 7, borderRadius: '50%', backgroundColor: mode.color }}
                />
              )}
            </Box>
          );
        })}
      </Box>

      <Menu
        open={Boolean(widgetMenu && menuWidget)}
        onClose={closeWidgetMenu}
        anchorReference="anchorPosition"
        anchorPosition={widgetMenu ? { top: widgetMenu.y, left: widgetMenu.x } : undefined}
        slotProps={{ paper: { sx: { minWidth: 240 } } }}
      >
        {menuWidget && <ListSubheader sx={{ fontWeight: 700, lineHeight: '36px' }}>{labelOf(menuWidget)}</ListSubheader>}
        <MenuItem onClick={pick((name) => setDraft(hideInDraft(draft, name, onTabNames.has(name))))}>
          <ListItemText inset primary={t('modes.editor.hide')} />
        </MenuItem>
        {tabs.length > 1 && <Divider />}
        {tabs.length > 1 && <ListSubheader sx={{ lineHeight: '28px' }}>{t('modes.editor.moveTo')}</ListSubheader>}
        {tabs.filter((item) => item.number !== tab).map((item) => (
          <MenuItem key={item.number} onClick={pick((name) => moveToTab(name, tab, item.number))}>
            <ListItemText inset primary={item.label || t('modes.editor.tabNumber', { number: item.number })} />
          </MenuItem>
        ))}
      </Menu>
      {carry.ghost}
    </Dialog>
  );
};

export default ModeLayoutEditor;
