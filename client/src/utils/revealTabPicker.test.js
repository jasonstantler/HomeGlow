import { describe, expect, it, vi } from 'vitest';
import { revealTabPicker } from './revealTabPicker.js';

// A page with just the pickers named, each with an input inside.
function page(names) {
  const pickers = Object.fromEntries(names.map((name) => [name, {
    scrollIntoView: vi.fn(),
    input: { focus: vi.fn() },
    querySelector(selector) { return selector === 'input' ? this.input : null; },
  }]));
  const doc = {
    querySelector: vi.fn((selector) => {
      const match = /^\[data-tab-picker="(.*)"\]$/.exec(selector);
      return match ? pickers[match[1].replace(/\\(.)/g, '$1')] || null : null;
    }),
  };
  return { doc, pickers };
}

describe('revealTabPicker', () => {
  it('scrolls to the first missing picker and focuses it', () => {
    const { doc, pickers } = page(['chores', 'plugin:chore-metrics.html']);
    expect(revealTabPicker(['plugin:chore-metrics.html', 'chores'], doc)).toBe(true);
    const picker = pickers['plugin:chore-metrics.html'];
    expect(picker.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    expect(picker.input.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(pickers.chores.scrollIntoView).not.toHaveBeenCalled();
  });

  it('skips a name with no picker on the page', () => {
    const { doc, pickers } = page(['weather']);
    expect(revealTabPicker(['plugin:gone.html', 'weather'], doc)).toBe(true);
    expect(pickers.weather.scrollIntoView).toHaveBeenCalled();
  });

  it('does nothing when no picker is there', () => {
    const { doc } = page([]);
    expect(revealTabPicker(['chores'], doc)).toBe(false);
    expect(revealTabPicker([], doc)).toBe(false);
  });
});

describe('widget settings links', () => {
  it('sends core widgets to Widgets and plugins to Plugins', async () => {
    const { adminLocationForWidget } = await import('./revealTabPicker.js');
    expect(adminLocationForWidget('calendar')).toEqual({ tab: 'dashboard', section: 'widgets' });
    expect(adminLocationForWidget('plugin:grill.html')).toEqual({ tab: 'dashboard', section: 'plugins' });
  });

  it('scrolls to the whole settings group and flashes it, without focusing the picker', async () => {
    const { revealWidgetSettings } = await import('./revealTabPicker.js');
    const group = { scrollIntoView: vi.fn(), animate: vi.fn() };
    const { doc, pickers } = page(['plugin:grill.html']);
    pickers['plugin:grill.html'].closest = (selector) => (selector === 'section' ? group : null);

    expect(revealWidgetSettings('plugin:grill.html', doc)).toBe(true);
    expect(group.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    expect(group.animate).toHaveBeenCalled();
    expect(pickers['plugin:grill.html'].input.focus).not.toHaveBeenCalled();
    expect(revealWidgetSettings('weather', doc)).toBe(false);
  });
});
