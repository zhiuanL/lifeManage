import {
  defaultTheme,
  isThemeKey,
  type ThemeKey,
} from "../../domain/life/ThemePreference";
import type { SystemRepository } from "../../repositories/system/SystemRepository";

const themePreferenceKey = "m1_theme_preference";

export class ThemePreferenceService {
  private writes: Promise<void> = Promise.resolve();
  constructor(private readonly systemRepository: SystemRepository) {}

  async getTheme(): Promise<ThemeKey> {
    const value = await this.systemRepository.getMetadata(themePreferenceKey);
    return isThemeKey(value) ? value : defaultTheme;
  }

  setTheme(theme: ThemeKey): Promise<void> {
    if (!isThemeKey(theme)) throw new Error("请选择有效的界面主题。");
    const write = this.writes.then(() => this.systemRepository.setMetadata(themePreferenceKey, theme));
    this.writes = write.catch(() => {});
    return write;
  }
}
