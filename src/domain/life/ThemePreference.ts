export const themeKeys = ["mist", "canopy", "night", "black", "warm-dark"] as const;

export type ThemeKey = (typeof themeKeys)[number];

export const defaultTheme: ThemeKey = "mist";

export const themeOptions: ReadonlyArray<{ key: ThemeKey; label: string }> = [
  { key: "mist", label: "暖色浅色" },
  { key: "black", label: "深黑" },
  { key: "night", label: "蓝灰深色" },
  { key: "warm-dark", label: "暖色深色" },
];

export function isThemeKey(value: string | null): value is ThemeKey {
  return value !== null && themeKeys.includes(value as ThemeKey);
}
