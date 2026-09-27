import { useSyncExternalStore } from "react";
import { getAppSetting, setAppSetting } from "../../internal/appSettings";

const KEY = "accent-color";
const EVENT = "accent-color-change";
const DEFAULT = "#d94d56";
const valid = (value: unknown): value is string => typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);

export function getAccentColor(): string {
  const value = localStorage.getItem(KEY);
  return valid(value) ? value : DEFAULT;
}

export function applyAccentColor(): void {
  const color = getAccentColor();
  document.documentElement.style.setProperty("--color-primary", color);
  document.documentElement.style.setProperty("--color-ring", color);
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
