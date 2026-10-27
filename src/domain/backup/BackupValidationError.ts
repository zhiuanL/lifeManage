export class BackupValidationError extends Error {
  constructor() {
    super("备份文件格式、版本或关联校验失败，未更改当前数据。");
    this.name = "BackupValidationError";
  }
}
