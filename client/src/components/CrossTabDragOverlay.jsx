import React, { useLayoutEffect, useRef } from 'react';
import { Box } from '@mui/material';
import { ChevronLeft, ChevronRight } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { edgeBandWidth } from '../utils/widgetTabMove.js';
import { EDGE_HOLD_MS } from '../hooks/useCrossTabDrag.js';

// What you see while dragging a widget toward another tab: a glowing band
// on the screen edge it's held against (filling up until the tab flips), the
// name of the tab it will flip to, and once a tab has flipped, the widget
// itself following your finger. Nothing here takes touches.

const LAYER_Z = 10000;

const EdgeBand = ({ side, label }) => {
  const width = edgeBandWidth(typeof window !== 'undefined' ? window.innerWidth : 0);
  return (
    <Box
      aria-hidden="true"
      sx={{
        position: 'fixed',
        top: 0,
        bottom: 0,
        [side < 0 ? 'left' : 'right']: 0,
        width,
        zIndex: LAYER_Z,
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: `linear-gradient(to ${side < 0 ? 'right' : 'left'}, rgba(var(--accent-rgb), 0.45), rgba(var(--accent-rgb), 0))`,
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0,
          bottom: 0,
          [side < 0 ? 'left' : 'right']: 0,
          width: 4,
          backgroundColor: 'var(--accent)',
          transformOrigin: 'bottom',
          animation: `hgEdgeFill ${EDGE_HOLD_MS}ms linear forwards`,
        },
        '@keyframes hgEdgeFill': {
          from: { transform: 'scaleY(0)' },
          to: { transform: 'scaleY(1)' },
        },
      }}
    >
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          color: 'var(--text)',
          fontSize: '0.75rem',
          fontWeight: 700,
          textAlign: 'center',
          writingMode: 'vertical-rl',
          transform: side < 0 ? 'rotate(180deg)' : 'none',
          textShadow: '0 1px 3px var(--hg-black-30)',
        }}
      >
        {side < 0 ? <ChevronLeft sx={{ transform: 'rotate(90deg)' }} /> : <ChevronRight sx={{ transform: 'rotate(90deg)' }} />}
        {label}
      </Box>
    </Box>
  );
};

const CrossTabDragOverlay = ({ edge, edgeTabLabel, carry, pointer, ghostRef, alreadyOnTab }) => {
  const { t } = useTranslation('common');
  const holderRef = useRef(null);

  // The carried copy is plain DOM made when the carry started; put it in.
  useLayoutEffect(() => {
    const holder = holderRef.current;
    const ghost = ghostRef?.current;
    if (!holder || !ghost) return undefined;
    holder.replaceChildren(ghost);
    return () => holder.replaceChildren();
  }, [carry?.widgetId, ghostRef]);

  return (
    <>
      {edge !== 0 && <EdgeBand key={`${edge}:${edgeTabLabel}`} side={edge} label={edgeTabLabel} />}
      {carry && pointer && (
        <Box
          aria-hidden="true"
          sx={{
            position: 'fixed',
            left: pointer.x - carry.offsetX,
            top: pointer.y - carry.offsetY,
            width: carry.width,
            height: carry.height,
            zIndex: LAYER_Z + 1,
            pointerEvents: 'none',
            transform: carry.landing ? 'scale(1)' : 'scale(1.03)',
            opacity: carry.landing ? 0 : 0.92,
            transition: carry.landing ? 'opacity 160ms ease, transform 160ms ease' : 'transform 120ms ease',
            filter: 'drop-shadow(0 18px 36px var(--hg-black-50))',
            borderRadius: 'var(--hg-frame-radius)',
            outline: '3px solid var(--accent)',
            overflow: 'hidden',
          }}
        >
          <Box ref={holderRef} sx={{ width: '100%', height: '100%' }} />
          {alreadyOnTab && (
            <Box
              sx={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'var(--hg-black-50)',
                color: '#fff',
                fontWeight: 700,
                textAlign: 'center',
                px: 2,
              }}
            >
              {t('widgetMenu.alreadyOnThisTab')}
            </Box>
          )}
        </Box>
      )}
    </>
  );
};

export default CrossTabDragOverlay;
