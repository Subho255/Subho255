// Runs in <head> before the page is drawn, so it never flashes the wrong theme.
// Day = pink kitten theme, night = dark "after hours" theme.
// Preference (localStorage "ho-theme"): auto (day 6:00-18:59), system, day or night.
(function () {
  var pref = 'auto';
  try { pref = localStorage.getItem('ho-theme') || 'auto'; } catch (e) { /* storage blocked */ }
  var theme;
  if (pref === 'day' || pref === 'night') theme = pref;
  else if (pref === 'system') theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'night' : 'day';
  else { var h = new Date().getHours(); theme = h >= 6 && h < 19 ? 'day' : 'night'; }
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.themePref = pref;
})();
