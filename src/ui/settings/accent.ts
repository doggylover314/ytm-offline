import { useSyncExternalStore } from "react";
import { getAppSetting, setAppSetting } from "../../internal/appSettings";

const KEY = "accent-color";
const EVENT = "accent-color-change";
const DEFAULT = "#ff0033";

/** The swatches offered in Settings, from the approved design. Red is the default. */
export const ACCENT_PRESETS: ReadonlyArray<{ name: string; value: string }> = [
  { name: "Red", value: DEFAULT },
  { name: "Orange", value: "#f2700f" },
  { name: "Yellow", value: "#e0b64a" },
  { name: "Green", value: "#2fa36b" },
  { name: "Blue", value: "#3d7bf2" },
  { name: "Purple", value: "#8a5cf5" },
  { name: "White", value: "#f2f2f2" },
];
const valid = (value: unknown): value is string => typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);

export function getAccentColor(): string {
  const value = localStorage.getItem(KEY);
  return valid(value) ? value : DEFAULT;
}

export function applyAccentColor(): void {
  const color = getAccentColor();
  document.documentElement.style.setProperty("--color-primary", color);
  document.documentElement.style.setProperty("--color-ring", color);
  // The playing song's title: the accent lightened enough to read as text on the page
  // (#FF0033 gives the design's #FF4D6D).
  document.documentElement.style.setProperty(
    "--color-accent-text",
    `color-mix(in srgb, ${color} 70%, #ffffff)`,
  );
}

export function setAccentColor(color: string): void {
  if (!valid(color)) return;
  localStorage.setItem(KEY, color);
  applyAccentColor();
  window.dispatchEvent(new Event(EVENT));
  void setAppSetting(KEY, color);
}

export async function hydrateAccentColor(): Promise<void> {
  const stored = await getAppSetting<unknown>(KEY);
  if (valid(stored)) localStorage.setItem(KEY, stored);
  applyAccentColor();
  window.dispatchEvent(new Event(EVENT));
}

export function useAccentColor(): string {
  return useSyncExternalStore(
    (callback) => {
      window.addEventListener(EVENT, callback);
      window.addEventListener("storage", callback);
      return () => {
        window.removeEventListener(EVENT, callback);
        window.removeEventListener("storage", callback);
      };
    },
    getAccentColor,
    () => DEFAULT,
  );
}
