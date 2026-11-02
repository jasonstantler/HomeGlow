import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { Add, Save } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { AdminFooter, AdminGroup, AdminNote, AdminRow } from './AdminRows.jsx';
import { API_BASE_URL } from '../utils/apiConfig.js';
import { getDeviceApiBase } from '../utils/deviceName.js';
import { editWholeNumber } from '../utils/wholeNumberField.js';
import {
  DISPLAY_MODES_KEY,
  MINUTES_PER_DAY,
  MODE_COLORS,
  findOverlaps,
  newModeId,
  normalizeModesSettings,
  scheduleDaysKey,
  staleModeTabs,
} from '../utils/displayModes.js';

const DEVICE_SETTINGS_UPDATED_EVENT = 'homeglow:device-settings-updated';
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const CORE_WIDGETS = ['calendar', 'weather', 'chores', 'photos'];

const emptyMode = () => ({
  id: newModeId(),
  name: '',
  color: MODE_COLORS[0],
  schedule: { days: [1, 2, 3, 4, 5], start: '06:00', end: '09:00' },
  startTab: null,
  dim: false,
  layouts: {},
});

const formatClock = (minutes, locale) => {
  const date = new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60);
  return date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
};

/**
 * Admin → Displays → Modes: this display's modes (utils/displayModes.js).
 * Modes save as they're added, changed or deleted; the behavior settings save
 * with the section's Save button. Everything is this display's own, kept in
 * its device settings, like its layouts.
 */
const ModesSettings = () => {
  const { t, i18n } = useTranslation(['admin', 'common']);
  const apiDeviceUrl = getDeviceApiBase(API_BASE_URL);
  const [stored, setStored] = useState(null);
  const [deviceSettings, setDeviceSettings] = useState({});
  const [behavior, setBehavior] = useState(null);
  const [tabs, setTabs] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [editing, setEditing] = useState(null);
  const [message, setMessage] = useState(null);
  const [saving, setSaving] = useState(false);

  const flash = (type, text) => {
    const next = { type, text };
    setMessage(next);
    if (type === 'success') setTimeout(() => setMessage((current) => (current === next ? null : current)), 4000);
  };

  const load = useCallback(async () => {
    try {
      const [settingsResponse, tabsResponse, assignmentsResponse] = await Promise.all([
        axios.get(`${apiDeviceUrl}/settings`),
        axios.get(`${apiDeviceUrl}/tabs`),
        axios.get(`${apiDeviceUrl}/widget-assignments`),
      ]);
      const settings = settingsResponse.data || {};
      const modes = normalizeModesSettings(settings[DISPLAY_MODES_KEY]);
      setDeviceSettings(settings);
      setStored(modes);
      setBehavior(modes);
      setTabs(Array.isArray(tabsResponse.data) ? tabsResponse.data : []);
      setAssignments(Array.isArray(assignmentsResponse.data) ? assignmentsResponse.data : []);
    } catch (error) {
      console.error('Error loading modes:', error);
      flash('error', t('admin:modes.loadFailed'));
    }
  }, [apiDeviceUrl, t]);

  useEffect(() => { void load(); }, [load]);

  const persist = async (next, successText) => {
    setSaving(true);
    try {
      await axios.patch(`${apiDeviceUrl}/settings`, { [DISPLAY_MODES_KEY]: next });
      window.dispatchEvent(new Event(DEVICE_SETTINGS_UPDATED_EVENT));
      await load();
      flash('success', successText);
      return true;
    } catch (error) {
      console.error('Error saving modes:', error);
      flash('error', error?.response?.data?.error || t('admin:modes.saveFailed'));
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Widgets turned on here, by tab, for the "layout out of date" check.
  const onTab = useMemo(() => {
    const widgetSettings = deviceSettings.widgetSettings || {};
    const pluginSettings = deviceSettings.pluginSettings || {};
    const isOn = (name) => (name.startsWith('plugin:')
      ? pluginSettings[name.slice('plugin:'.length)]?.enabled === true
      : CORE_WIDGETS.includes(name) && widgetSettings[name]?.enabled === true);
    const out = {};
    assignments.forEach((row) => {
      if (!isOn(row.widget_name)) return;
      (out[row.tab_number] ||= []).push(row.widget_name);
    });
    return out;
  }, [assignments, deviceSettings]);

  const tabName = (number) => {
    const tab = tabs.find((item) => item.number === Number(number));
    return tab?.label || t('admin:modes.tabNumber', { number });
  };

  const widgetLabel = (name) => (name.startsWith('plugin:')
    ? name.slice('plugin:'.length).replace(/\.html?$/i, '')
    : t(`admin:screensaver.expand.widgetNames.${name}`, { defaultValue: name }));

  const scheduleText = (schedule) => {
    if (!schedule) return t('admin:modes.noSchedule');
    const key = scheduleDaysKey(schedule.days);
    const days = key
      ? t(`admin:modes.days.${key}`)
      : DAY_ORDER.filter((day) => schedule.days.includes(day)).map((day) => t(`admin:modes.dayShort.${day}`)).join(', ');
    const [sh, sm] = schedule.start.split(':').map(Number);
    const [eh, em] = schedule.end.split(':').map(Number);
    return `${days} · ${formatClock(sh * 60 + sm, i18n.language)} – ${formatClock(eh * 60 + em, i18n.language)}`;
  };

  if (!stored || !behavior) {
    return message ? <Alert severity={message.type}>{message.text}</Alert> : null;
  }

  const saveMode = async (mode) => {
    const exists = stored.modes.some((item) => item.id === mode.id);
    const modes = exists
      ? stored.modes.map((item) => (item.id === mode.id ? mode : item))
      : [...stored.modes, mode];
    if (await persist({ ...stored, modes }, t('admin:modes.savedMode', { name: mode.name }))) setEditing(null);
  };

  const deleteMode = async (mode) => {
    if (!window.confirm(t('admin:modes.confirmDelete', { name: mode.name }))) return;
    const modes = stored.modes.filter((item) => item.id !== mode.id);
    if (await persist({ ...stored, modes }, t('admin:modes.deleted', { name: mode.name }))) setEditing(null);
  };

  const saveBehavior = () => persist(
    normalizeModesSettings({ ...behavior, modes: stored.modes }),
    t('admin:modes.savedBehavior')
  );
  const setField = (patch) => setBehavior((prev) => ({ ...prev, ...patch }));

  return (
    <>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, px: 0.5 }}>
        {t('admin:modes.help')}
      </Typography>

      {message && (
        <Alert severity={message.type} onClose={() => setMessage(null)} sx={{ mb: 2 }}>{message.text}</Alert>
      )}

      <AdminGroup
        title={t('admin:modes.listHeading')}
        action={(
          <Button size="small" startIcon={<Add />} onClick={() => setEditing(emptyMode())}>
            {t('admin:modes.add')}
          </Button>
        )}
      >
        {stored.modes.length === 0 && <AdminNote>{t('admin:modes.empty')}</AdminNote>}
        {stored.modes.map((mode) => {
          const stale = staleModeTabs(mode, onTab);
          const layoutTabs = Object.keys(mode.layouts);
          return (
            <ButtonBase
              key={mode.id}
              onClick={() => setEditing(mode)}
              aria-label={t('admin:modes.editMode', { name: mode.name })}
              sx={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-start',
                gap: 1.5,
                p: 1.5,
                textAlign: 'left',
                borderRadius: 'var(--hg-radius-md, 8px)',
                '&:hover': { backgroundColor: 'action.hover' },
              }}
            >
              <Box sx={{ width: 8, alignSelf: 'stretch', minHeight: 40, borderRadius: 1, backgroundColor: mode.color, flex: 'none' }} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontWeight: 700 }}>{mode.name}</Typography>
                <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap', mt: 0.5 }}>
                  <Chip size="small" label={scheduleText(mode.schedule)} />
                  {mode.startTab && <Chip size="small" label={t('admin:modes.startsOn', { tab: tabName(mode.startTab) })} />}
                  {mode.dim && <Chip size="small" label={t('admin:modes.dimChip')} />}
                  <Chip
                    size="small"
                    label={layoutTabs.length > 0
                      ? t('admin:modes.layoutsChip', { tabs: layoutTabs.map(tabName).join(', ') })
                      : t('admin:modes.noLayouts')}
                  />
                </Stack>
                {Object.entries(stale).map(([tab, names]) => (
                  <Typography key={tab} variant="body2" sx={{ color: 'warning.main', mt: 0.5 }}>
                    {t('admin:modes.outOfDate', { tab: tabName(tab), widgets: names.map(widgetLabel).join(', ') })}
                  </Typography>
                ))}
              </Box>
            </ButtonBase>
          );
        })}
      </AdminGroup>

      <AdminGroup title={t('admin:modes.behaviorHeading')}>
        <AdminRow
          label={t('admin:modes.showLabel')}
          hint={t('admin:modes.showLabelHelp')}
          control={(
            <Switch
              checked={behavior.showLabel}
              onChange={(e) => setField({ showLabel: e.target.checked })}
              slotProps={{ input: { 'aria-label': t('admin:modes.showLabel') } }}
            />
          )}
        />
        <AdminRow
          label={t('admin:modes.fade')}
          hint={t('admin:modes.fadeHelp')}
          control={(
            <Switch
              checked={behavior.fade}
              onChange={(e) => setField({ fade: e.target.checked })}
              slotProps={{ input: { 'aria-label': t('admin:modes.fade') } }}
            />
          )}
        />
        <AdminRow
          label={t('admin:modes.touchWait')}
          hint={t('admin:modes.touchWaitHelp')}
          control={(
            <TextField
              type="number"
              size="small"
              label={t('admin:modes.seconds')}
              value={behavior.touchWaitSeconds}
              onChange={(e) => setField({ touchWaitSeconds: editWholeNumber(e.target.value) })}
              slotProps={{ htmlInput: { min: 0, max: 600, step: 5 } }}
              sx={{ width: 130 }}
            />
          )}
        />
        <AdminRow
          label={t('admin:modes.returnAfter')}
          hint={t('admin:modes.returnAfterHelp')}
          control={(
            <TextField
              type="number"
              size="small"
              label={t('admin:modes.minutes')}
              value={behavior.returnMinutes}
              onChange={(e) => setField({ returnMinutes: editWholeNumber(e.target.value) })}
              slotProps={{ htmlInput: { min: 0, max: 120, step: 1 } }}
              sx={{ width: 130 }}
            />
          )}
        />
      </AdminGroup>

      <AdminFooter>
        <Button variant="contained" onClick={saveBehavior} disabled={saving} startIcon={<Save />}>
          {t('admin:modes.save')}
        </Button>
      </AdminFooter>

      {editing && (
        <ModeDialog
          mode={editing}
          isNew={!stored.modes.some((item) => item.id === editing.id)}
          otherModes={stored.modes.filter((item) => item.id !== editing.id)}
          tabs={tabs}
          tabName={tabName}
          saving={saving}
          onCancel={() => setEditing(null)}
          onSave={saveMode}
          onDelete={deleteMode}
          scheduleText={scheduleText}
          locale={i18n.language}
        />
      )}
    </>
  );
};

const ModeDialog = ({ mode, isNew, otherModes, tabs, tabName, saving, onCancel, onSave, onDelete, locale }) => {
  const { t } = useTranslation(['admin']);
  const [draft, setDraft] = useState(mode);
  const set = (patch) => setDraft((prev) => ({ ...prev, ...patch }));
  const setSchedule = (patch) => setDraft((prev) => ({ ...prev, schedule: { ...prev.schedule, ...patch } }));
  const scheduled = Boolean(draft.schedule);

  const overlaps = useMemo(() => {
    if (!scheduled || draft.schedule.days.length === 0) return [];
    return findOverlaps([draft, ...otherModes]).filter((hit) => hit.a === draft.id || hit.b === draft.id);
  }, [draft, otherModes, scheduled]);

  const sameTimes = scheduled && draft.schedule.start === draft.schedule.end;
  const noDays = scheduled && draft.schedule.days.length === 0;
  const nameTaken = otherModes.some((item) => item.name.trim().toLowerCase() === draft.name.trim().toLowerCase());
  const canSave = draft.name.trim() && !nameTaken && overlaps.length === 0 && !sameTimes && !noDays && !saving;

  const overlapText = (hit) => {
    const other = otherModes.find((item) => item.id === (hit.a === draft.id ? hit.b : hit.a));
    const day = Math.floor(hit.from / MINUTES_PER_DAY) % 7;
    return t('admin:modes.overlap', {
      name: other?.name || '',
      day: t(`admin:modes.dayLong.${day}`),
      from: formatClock(hit.from % MINUTES_PER_DAY, locale),
      to: formatClock(hit.to % MINUTES_PER_DAY, locale),
    });
  };

  return (
    <Dialog open onClose={onCancel} maxWidth="sm" fullWidth>
      <DialogTitle>{isNew ? t('admin:modes.newTitle') : t('admin:modes.editTitle', { name: mode.name })}</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          <TextField
            label={t('admin:modes.name')}
            value={draft.name}
            onChange={(e) => set({ name: e.target.value.slice(0, 40) })}
            error={Boolean(nameTaken)}
            helperText={nameTaken ? t('admin:modes.nameTaken') : t('admin:modes.nameHelp')}
            autoFocus={isNew}
          />

          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('admin:modes.color')}</Typography>
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
              {MODE_COLORS.map((color) => (
                <ButtonBase
                  key={color}
                  onClick={() => set({ color })}
                  aria-label={color}
                  aria-pressed={draft.color === color}
                  sx={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    backgroundColor: color,
                    outline: draft.color === color ? '3px solid' : 'none',
                    outlineColor: 'text.primary',
                    outlineOffset: 2,
                  }}
                />
              ))}
            </Stack>
          </Box>

          <Box>
            <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography variant="subtitle2">{t('admin:modes.onSchedule')}</Typography>
              <Switch
                checked={scheduled}
                onChange={(e) => set({ schedule: e.target.checked ? emptyMode().schedule : null })}
                slotProps={{ input: { 'aria-label': t('admin:modes.onSchedule') } }}
              />
            </Stack>
            {!scheduled && (
              <Typography variant="body2" color="text.secondary">{t('admin:modes.byHandHelp')}</Typography>
            )}
            {scheduled && (
              <Stack spacing={2} sx={{ mt: 1 }}>
                <ToggleButtonGroup
                  value={draft.schedule.days}
                  onChange={(_, days) => setSchedule({ days: [...days].sort() })}
                  aria-label={t('admin:modes.daysLabel')}
                  size="small"
                  sx={{ flexWrap: 'wrap', '& .MuiToggleButton-root': { textTransform: 'none', minWidth: 48 } }}
                >
                  {DAY_ORDER.map((day) => (
                    <ToggleButton key={day} value={day} aria-label={t(`admin:modes.dayLong.${day}`)}>
                      {t(`admin:modes.dayShort.${day}`)}
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
                <Stack direction="row" spacing={2}>
                  <TextField
                    type="time"
                    label={t('admin:modes.start')}
                    value={draft.schedule.start}
                    onChange={(e) => e.target.value && setSchedule({ start: e.target.value })}
                    slotProps={{ inputLabel: { shrink: true } }}
                    sx={{ flex: 1 }}
                  />
                  <TextField
                    type="time"
                    label={t('admin:modes.end')}
                    value={draft.schedule.end}
                    onChange={(e) => e.target.value && setSchedule({ end: e.target.value })}
                    slotProps={{ inputLabel: { shrink: true } }}
                    helperText={draft.schedule.end < draft.schedule.start ? t('admin:modes.nextDay') : ' '}
                    sx={{ flex: 1 }}
                  />
                </Stack>
                {noDays && <Alert severity="warning">{t('admin:modes.pickDays')}</Alert>}
                {sameTimes && <Alert severity="warning">{t('admin:modes.sameTimes')}</Alert>}
                {overlaps.map((hit) => (
                  <Alert key={`${hit.a}-${hit.b}`} severity="error">{overlapText(hit)}</Alert>
                ))}
              </Stack>
            )}
          </Box>

          <TextField
            select
            label={t('admin:modes.startTab')}
            value={draft.startTab ?? ''}
            onChange={(e) => set({ startTab: e.target.value === '' ? null : Number(e.target.value) })}
            helperText={t('admin:modes.startTabHelp')}
            slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
          >
            <MenuItem value="">{t('admin:modes.startTabNone')}</MenuItem>
            {tabs.map((tab) => (
              <MenuItem key={tab.number} value={tab.number}>{tab.label || tabName(tab.number)}</MenuItem>
            ))}
          </TextField>

          <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <Box>
              <Typography variant="subtitle2">{t('admin:modes.dim')}</Typography>
              <Typography variant="body2" color="text.secondary">{t('admin:modes.dimHelp')}</Typography>
            </Box>
            <Switch
              checked={draft.dim}
              onChange={(e) => set({ dim: e.target.checked })}
              slotProps={{ input: { 'aria-label': t('admin:modes.dim') } }}
            />
          </Stack>

          <Box>
            <Typography variant="subtitle2">{t('admin:modes.layouts')}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{t('admin:modes.layoutsHelp')}</Typography>
            {Object.keys(draft.layouts).length === 0 && (
              <Typography variant="body2" sx={{ fontStyle: 'italic' }}>{t('admin:modes.noLayouts')}</Typography>
            )}
            {Object.keys(draft.layouts).map((tab) => (
              <Stack key={tab} direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', py: 0.5 }}>
                <Typography>{tabName(tab)}</Typography>
                <Button
                  size="small"
                  color="error"
                  onClick={() => {
                    const { [tab]: _cleared, ...rest } = draft.layouts;
                    set({ layouts: rest });
                  }}
                >
                  {t('admin:modes.clearLayout')}
                </Button>
              </Stack>
            ))}
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'space-between', px: 3, pb: 2 }}>
        {!isNew ? (
          <Button color="error" onClick={() => onDelete(mode)} disabled={saving}>{t('admin:modes.delete')}</Button>
        ) : <span />}
        <Stack direction="row" spacing={1}>
          <Button onClick={onCancel}>{t('admin:modes.cancel')}</Button>
          <Button variant="contained" onClick={() => onSave({ ...draft, name: draft.name.trim() })} disabled={!canSave}>
            {t('admin:modes.saveMode')}
          </Button>
        </Stack>
      </DialogActions>
    </Dialog>
  );
};

export default ModesSettings;
