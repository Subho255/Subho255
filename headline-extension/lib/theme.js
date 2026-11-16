// Day/night theme. The preference lives in localStorage so theme-init.js can apply it
// synchronously before the page is drawn (popup and settings share the extension origin).

const KEY = 'ho-theme';
export const THEME_PREFS = [
  { id: 'auto', label: 'Auto: day from 6am to 7pm, night after' },
  { id: 'system', label: 'Follow my system (light = day, dark = night)' },
  { id: 'day', label: 'Always day (pink kitten)' },
  { id: 'night', label: 'Always night (dark)' },
];

export function getThemePref() {
  try { return localStorage.getItem(KEY) || 'auto'; } catch { return 'auto'; }
}

export function resolveTheme(pref, now = new Date(), systemDark = matchMedia('(prefers-color-scheme: dark)').matches) {
  if (pref === 'day' || pref === 'night') return pref;
  if (pref === 'system') return systemDark ? 'night' : 'day';
  const h = now.getHours();
  return h >= 6 && h < 19 ? 'day' : 'night';
}

export function applyTheme(pref = getThemePref()) {
  document.documentElement.dataset.theme = resolveTheme(pref);
  document.documentElement.dataset.themePref = pref;
  return document.documentElement.dataset.theme;
}

export function setThemePref(pref) {
  try { localStorage.setItem(KEY, pref); } catch { /* storage blocked: applies for this page only */ }
  return applyTheme(pref);
}

/** Keeps "system" in sync if the OS switches while the page is open. */
export function watchSystemTheme() {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getThemePref() === 'system') applyTheme('system');
  });
}
