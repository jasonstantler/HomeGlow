import { describe, expect, it } from 'vitest';
import { nearestFreeCell } from './useCarryToTab.jsx';

describe('nearestFreeCell', () => {
  it('keeps a free spot', () => {
    expect(nearestFreeCell({ x: 6, y: 2, w: 6, h: 4 }, [{ x: 0, y: 0, w: 6, h: 6 }])).toEqual({ x: 6, y: 2, w: 6, h: 4 });
  });
  it('moves off a taken spot to the closest free one', () => {
    expect(nearestFreeCell({ x: 2, y: 1, w: 6, h: 4 }, [{ x: 0, y: 0, w: 6, h: 6 }])).toEqual({ x: 6, y: 1, w: 6, h: 4 });
  });
  it('goes below a full row', () => {
    expect(nearestFreeCell({ x: 0, y: 0, w: 12, h: 2 }, [{ x: 0, y: 0, w: 12, h: 3 }])).toEqual({ x: 0, y: 3, w: 12, h: 2 });
  });
});
