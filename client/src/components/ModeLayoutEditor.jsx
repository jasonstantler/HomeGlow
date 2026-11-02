import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import WidgetContainer from './WidgetContainer.jsx';
import {
  hideInDraft,
  showInDraft,
  startDraft,
  visibleGridRows,
} from '../utils/displayModes.js';
import { readGridMetrics } from '../utils/gridMetrics.js';

// How big the preview is next to the real wall.
const PREVIEW_SCALE = 0.85;
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

  const grid = useMemo(() => buildWidgets(tab, draft.saved), [buildWidgets, tab, draft.saved]);

  const saveFromGrid = (layoutRows, tabNumber) => {
    setDrafts((prev) => {
      const current = prev[tabNumber] || startDraft(mode, tabNumber, tabWidgets(tabNumber));
      const saved = { ...current.saved };
      layoutRows.forEach((row) => {
        saved[row.widget_name] = { x: row.layout_x, y: row.layout_y, w: row.layout_w, h: row.layout_h };
      });
      return { ...prev, [tabNumber]: { ...current, saved } };
    });
  };

  const toggle = (name) => {
    if (draft.saved[name]) setDraft(hideInDraft(draft, name, onTabNames.has(name)));
    else setDraft(showInDraft(draft, name, sizeOf(name), rows));
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
        <TextField
          select
          size="small"
          label={t('modes.editor.tab')}
          value={tab}
          onChange={(e) => setTab(Number(e.target.value))}
          sx={{ minWidth: 160 }}
        >
          {tabs.map((item) => (
            <MenuItem key={item.number} value={item.number}>
              {item.label || t('modes.editor.tabNumber', { number: item.number })}
              {drafts[item.number] || mode.layouts?.[item.number] ? ' •' : ''}
            </MenuItem>
          ))}
        </TextField>
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

      <Box sx={{ flex: 1, overflow: 'auto', py: 3, display: 'flex', justifyContent: 'center' }}>
        <Box
          sx={{
            width: viewport.width * PREVIEW_SCALE,
            height: viewport.height * PREVIEW_SCALE,
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
            sx={{
              width: viewport.width,
              height: viewport.height,
              transform: `scale(${PREVIEW_SCALE})`,
              transformOrigin: 'top left',
              overflow: 'hidden',
            }}
          >
            {grid.length > 0 ? (
              <WidgetContainer
                key={tab}
                widgets={grid}
                locked={false}
                activeTab={tab}
                activeTabId={tabs.find((item) => item.number === tab)?.id ?? tab}
                scale={PREVIEW_SCALE}
                onSaveLayouts={saveFromGrid}
              />
            ) : (
              <Typography sx={{ p: 6, textAlign: 'center', color: 'var(--text-secondary)' }}>
                {t('modes.editor.empty')}
              </Typography>
            )}
          </Box>
        </Box>
      </Box>
    </Dialog>
  );
};

export default ModeLayoutEditor;
