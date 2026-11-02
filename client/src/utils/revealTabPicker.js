// When Save is refused because an enabled widget or plugin has no tab, the
// message sits at the top of Admin, often off screen on a phone. This brings
// the first such tab picker into view and puts the cursor in it.
//
// Each picker carries data-tab-picker="<widget name>" ('chores',
// 'plugin:chore-metrics.html').

// A quoted attribute value only needs its quotes and backslashes escaped.
const quoted = (value) => `"${String(value).replace(/["\\]/g, '\\$&')}"`;

/** Scroll to the first named picker found and focus its input. False when none is on the page. */
export function revealTabPicker(widgetNames, doc = document) {
  for (const name of widgetNames || []) {
    const picker = doc.querySelector(`[data-tab-picker=${quoted(name)}]`);
    if (!picker) continue;
    picker.scrollIntoView({ behavior: 'smooth', block: 'center' });
    picker.querySelector('input')?.focus({ preventScroll: true });
    return true;
  }
  return false;
}

/**
 * Where a widget's settings are in Admin: core widgets under Dashboard →
 * Widgets, plugins under Dashboard → Plugins.
 */
export function adminLocationForWidget(widgetName) {
  return {
    tab: 'dashboard',
    section: String(widgetName || '').startsWith('plugin:') ? 'plugins' : 'widgets',
  };
}

/**
 * Bring a widget's settings group into view and flash it, without opening its
 * tab picker (the widget menu's "Widget settings"). False when it isn't on
 * the page yet — Admin may still be loading, or waiting for its PIN.
 */
export function revealWidgetSettings(widgetName, doc = document) {
  const picker = doc.querySelector(`[data-tab-picker=${quoted(widgetName)}]`);
  if (!picker) return false;
  const group = picker.closest?.('section') || picker;
  group.scrollIntoView({ behavior: 'smooth', block: 'start' });
  group.animate?.(
    [
      { boxShadow: '0 0 0 3px var(--accent)', borderRadius: '12px' },
      { boxShadow: '0 0 0 3px transparent', borderRadius: '12px' },
    ],
    { duration: 1600, easing: 'ease-out' }
  );
  return true;
}
