const messages = {
  module: "模块设置读取失败，请检查本地设置或恢复备份。",
  navigation: "导航设置读取失败，请检查本地设置或恢复备份。",
} as const;

export class PreferenceReadError extends Error {
  constructor(readonly preference: keyof typeof messages) {
    super(messages[preference]);
    this.name = "PreferenceReadError";
  }
}
