/**
 * The app is dark only. `data-theme` is still set on <html> so the few CSS rules that key on
 * it, and `color-scheme` for native form controls, see the right value.
 */
export function applyTheme(): void {
  document.documentElement.setAttribute("data-theme", "dark");
}
