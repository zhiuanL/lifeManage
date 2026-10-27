const messages = {
  legacy:
    "检测到与当前版本不兼容的旧版本地数据库。原有记录未被迁移或删除。请先退出 LifeOS，备份应用数据目录中的 lifeos.db；若要使用新的空白空间，请在备份后把旧文件移出该目录，再重新打开。",
  newer:
    "数据库包含较新版本或未知的迁移记录，已停止写入。请先备份 lifeos.db，并使用创建该数据库的应用版本打开。",
  "missing-inbox-privacy":
    "收集箱的隐私字段缺失，已停止初始化，原有记录未被修改。请先备份当前 lifeos.db；" +
    "需要使用迁移前包含隐私设置的备份恢复，不能自动推测原隐私等级。",
} as const;

export class DatabaseCompatibilityError extends Error {
  constructor(readonly reason: keyof typeof messages) {
    super(messages[reason]);
    this.name = "DatabaseCompatibilityError";
  }
}
