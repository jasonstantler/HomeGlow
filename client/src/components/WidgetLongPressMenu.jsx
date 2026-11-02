import React, { useEffect, useState } from 'react';
import {
  Box,
  Divider,
  IconButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  MenuList,
  Popover,
  Typography,
} from '@mui/material';
import {
  Add,
  ArrowBack,
  AspectRatio,
  ChevronRight,
  ContentCopy,
  DriveFileMove,
  RemoveCircleOutlined,
  Settings,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { SIZE_PRESETS } from '../utils/widgetTabMove.js';

// The menu a long press opens on a widget in Move/Resize mode. Built for a
// finger on a wall display: big rows, and a second page (pick a tab, pick a
// size) in place of submenus that would open off to the side.

// A little picture of how much of the screen each size takes.
const SizeGlyph = ({ preset }) => {
  const fill = {
    small: { width: '34%', height: '22%' },
    medium: { width: '50%', height: '30%' },
    half: { width: '100%', height: '50%' },
    full: { width: '100%', height: '100%' },
  }[preset];
  return (
    <Box sx={{ width: 18, height: 26, border: '1.5px solid currentColor', borderRadius: '3px', p: '2px', boxSizing: 'border-box' }}>
      <Box sx={{ ...fill, backgroundColor: 'currentColor', borderRadius: '1px' }} />
    </Box>
  );
};

const rowSx = { minHeight: 52, px: 2, borderRadius: 'var(--hg-radius-md)', mx: 0.5 };

const WidgetLongPressMenu = ({
  open,
  anchorPosition,
  title,
  tabChoices = [],
  onMoveToTab,
  onDuplicateToTab,
  onNewTab,
  onSize,
  onOpenSettings,
  onRemove,
  onClose,
}) => {
  const { t } = useTranslation('common');
  const [view, setView] = useState('main');

  useEffect(() => {
    if (open) setView('main');
  }, [open]);

  const choose = (action) => () => {
    onClose();
    action();
  };

  const tabList = (onPick, mode) => (
    <>
      {tabChoices.map((tab) => (
        <MenuItem
          key={tab.number}
          sx={rowSx}
          disabled={tab.alreadyThere}
          onClick={choose(() => onPick(tab.number))}
        >
          <ListItemText
            primary={tab.label}
            secondary={tab.alreadyThere ? t('widgetMenu.alreadyThere') : null}
          />
        </MenuItem>
      ))}
      <MenuItem sx={rowSx} onClick={choose(() => onNewTab(mode))}>
        <ListItemIcon><Add /></ListItemIcon>
        <ListItemText primary={t('widgetMenu.newTab')} />
      </MenuItem>
    </>
  );

  const header = (label, back) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: back ? 0.5 : 2, pt: 1, pb: 0.5 }}>
      {back && (
        <IconButton size="small" onClick={() => setView('main')} aria-label={t('widgetMenu.back')}>
          <ArrowBack fontSize="small" />
        </IconButton>
      )}
      <Typography variant="overline" sx={{ fontWeight: 700, color: 'var(--text-secondary)', lineHeight: 1.6 }} noWrap>
        {label}
      </Typography>
    </Box>
  );

  return (
    <Popover
      open={open}
      onClose={onClose}
      anchorReference="anchorPosition"
      anchorPosition={anchorPosition || { top: 0, left: 0 }}
      anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      // Over the dock (9999) and the drag layer, so it can't open beneath them.
      sx={{ zIndex: 10002 }}
      slotProps={{
        paper: {
          'data-widget-menu': 'true',
          sx: {
            minWidth: 260,
            maxWidth: 340,
            borderRadius: 'var(--hg-radius-lg)',
            border: '1px solid var(--card-border)',
            boxShadow: '0 12px 40px var(--hg-black-30)',
            py: 0.5,
          },
        },
      }}
    >
      {view === 'main' && (
        <>
          {header(title)}
          <MenuList dense={false} autoFocusItem={false} sx={{ py: 0 }}>
            <MenuItem sx={rowSx} onClick={() => setView('move')}>
              <ListItemIcon><DriveFileMove /></ListItemIcon>
              <ListItemText primary={t('widgetMenu.moveToTab')} />
              <ChevronRight fontSize="small" sx={{ color: 'var(--text-secondary)' }} />
            </MenuItem>
            <MenuItem sx={rowSx} onClick={() => setView('duplicate')}>
              <ListItemIcon><ContentCopy /></ListItemIcon>
              <ListItemText primary={t('widgetMenu.duplicateToTab')} secondary={t('widgetMenu.duplicateHint')} />
              <ChevronRight fontSize="small" sx={{ color: 'var(--text-secondary)' }} />
            </MenuItem>
            <MenuItem sx={rowSx} onClick={() => setView('size')}>
              <ListItemIcon><AspectRatio /></ListItemIcon>
              <ListItemText primary={t('widgetMenu.size')} />
              <ChevronRight fontSize="small" sx={{ color: 'var(--text-secondary)' }} />
            </MenuItem>
            <MenuItem sx={rowSx} onClick={choose(onOpenSettings)}>
              <ListItemIcon><Settings /></ListItemIcon>
              <ListItemText primary={t('widgetMenu.settings')} />
            </MenuItem>
            <Divider sx={{ my: 0.5 }} />
            <MenuItem sx={{ ...rowSx, color: 'var(--hg-error)' }} onClick={choose(onRemove)}>
              <ListItemIcon sx={{ color: 'inherit' }}><RemoveCircleOutlined /></ListItemIcon>
              <ListItemText primary={t('widgetMenu.remove')} />
            </MenuItem>
          </MenuList>
        </>
      )}

      {view === 'move' && (
        <>
          {header(t('widgetMenu.moveToTab'), true)}
          <MenuList sx={{ py: 0 }}>{tabList(onMoveToTab, 'move')}</MenuList>
        </>
      )}

      {view === 'duplicate' && (
        <>
          {header(t('widgetMenu.duplicateToTab'), true)}
          <MenuList sx={{ py: 0 }}>{tabList(onDuplicateToTab, 'duplicate')}</MenuList>
        </>
      )}

      {view === 'size' && (
        <>
          {header(t('widgetMenu.size'), true)}
          <MenuList sx={{ py: 0 }}>
            {SIZE_PRESETS.map((preset) => (
              <MenuItem key={preset} sx={rowSx} onClick={choose(() => onSize(preset))}>
                <ListItemIcon><SizeGlyph preset={preset} /></ListItemIcon>
                <ListItemText primary={t(`widgetMenu.sizes.${preset}`)} />
              </MenuItem>
            ))}
          </MenuList>
        </>
      )}
    </Popover>
  );
};

export default WidgetLongPressMenu;
