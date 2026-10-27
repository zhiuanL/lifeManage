export type StorageEnvironment = "desktop" | "browser-preview";

export interface StorageStatus {
  environment: StorageEnvironment;
  label: string;
  detail: string;
}

export function createStorageStatus(
  environment: StorageEnvironment,
  currentVersion: string,
): StorageStatus {
  if (environment === "browser-preview") {
    return {
      environment,
      label: "浏览器预览存储已就绪",
      detail: `临时本地存储已初始化至 ${currentVersion}。`,
    };
  }

  return {
    environment,
    label: "本地存储已就绪",
    detail: `SQLite 迁移已更新至 ${currentVersion}。`,
  };
}
