# V1 免安装交付与平台边界

日期：2026-10-22。此文只记录本批免安装调试候选版，不将其称为优化、签名的
正式发布版；安装包按用户要求延后。

最新免安装运行目录为 `portable/v1-20261022-no-console/`：Windows 入口统一使用
GUI 子系统，不再只在 release 中隐藏控制台。下方 `v1-20261022` 路径与 hash
记录保留为首批历史，最新版本不显示启动黑框，两个应用标识和数据空间保持不变。

最新 EXE 的 PE 子系统均实测为 2（GUI），旧版均为 3（控制台）。
新隔离版校验后原生启动通过，证据 `.verification/v1-20261022/no-console/`；
原数据候选仍只构建、不启动。入口 / 配置回归 4 项、lint、隔离前端构建和
cargo check 通过，未重跑业务全量。没有新增迁移或依赖。

| 最新输出 | SHA-256 |
| --- | --- |
| `v1-20261022-no-console/test/LifeOS.exe` | `0dce5a4ee0b07dd1f3904a338fec50920b7383eaff146f1e5d79305013d27019` |
| `v1-20261022-no-console/user-data/LifeOS.exe` | `1e7d3d78c2b6bfa5a63c8913f20cbc21ed5720a43b525e83cf4f124b93c983c6` |

## macOS 架构复核

FINAL 工程规范 §13.7 明确要求 macOS 架构兼容性检查，不要求本里程碑正式分发。
真实 macOS 构建和设备运行未测试，但不是本阶段额外的必做开发任务。

| 检查点 | 源码证据与结论 |
| --- | --- |
| 桌面入口 | `src-tauri/src/lib.rs` 使用 Tauri Builder、SQL 插件及备份 / 事务命令，无 Windows 专属业务分支。 |
| Windows 窗口属性 | `src-tauri/src/main.rs` 的 `windows_subsystem` 属性沿用 Tauri 模板；不把平台属性用作业务规则。 |
| 数据库 | `src/repositories/sqlite/TauriSqliteExecutor.ts` 使用插件相对 URL `sqlite:lifeos.db`，不硬编码 Windows 盘符或 AppData 路径。 |
| 安全副本 | `src-tauri/src/backup.rs` 使用 `app.path().app_config_dir()` 并通过路径 API 拼接 `backups`；不是字符串拼接 Windows 路径。 |
| 事务与格式 | `src-tauri/src/transaction.rs` 使用 SQLx SQLite 事务；备份使用 Serde JSON。生产逻辑不依赖注册表、COM 或 PowerShell。 |
| 依赖与权限 | `src-tauri/Cargo.toml` 使用 Tauri 2、SQLite、Serde；`capabilities/default.json` 为桌面核心与 SQL 权限，没有限定 Windows 的业务权限。 |
| 交付脚本 | `tools/Build-V1Preview.ps1` 仅为 Windows 构建工具，不被产品运行时依赖；本次不生成 macOS 产物。 |

保留 `com.lifeos.app`：既有 macOS 命名警告单独记录，未经数据路径迁移方案
不修改应用标识。本次是源码架构检查，不等于 macOS 编译、签名、公证或实机兼容认证。

## 数据安全与版本

前端只读取 `.verification/v1-20261022/web` 的已验证构建，不覆盖旧 `dist`。
Tauri 使用 `--debug --no-bundle --ci` 和禁用 bundle 的配置；
旧 release / preview EXE 不覆盖。

本批两个输出分别为：

- `portable/v1-20261022/test/LifeOS.exe`：隔离标识 `com.lifeos.verification20261022`。
- `portable/v1-20261022/user-data/LifeOS.exe`：原标识 `com.lifeos.app`，仅构建，禁止自动测试脚本启动。

数据仍由 Tauri 平台目录管理，不保存在免安装目录中。模式 / 备份版本 52，
兼容备份 15–52；使用原数据版会执行向前迁移，升级前必须保留备份。
详见 `portable/v1-20261022-notes.md`。

构建脚本拒绝覆盖已有输出；自动验证脚本必须同时核对隔离标识、数据模式与
EXE SHA-256 才能启动。正式数据目录从未被本批脚本读取、复制或迁移。

## 运行证据

最终功能回归、Rust 原生恢复、桌面核心闭环、重启读取、应用层离线与样本性能
证据见 `V1_FINAL_SOURCE_AUDIT.md`；本批运行结果另外保存在
`.verification/v1-20261022/portable/report.json`。

原生缩放通过 Tauri 当前窗口 `scale_factor` 和 `inner_size` 读取，
不使用设备模拟、不修改系统缩放。只有实测因子为 1.25 才记录为真实 125%；
其他因子只说明当前系统环境，不伪称该项通过。

本批实测：`scaleFactor=1`、`devicePixelRatio=1`，物理窗口及 CSS 视口均
1200×780，无横向溢出、页面异常；已查看 `native-home.png`。
真实 125% 因本机当前环境未覆盖，仍单独列为未验证。

| 输出 | 大小 | SHA-256 |
| --- | --- | --- |
| 隔离测试 EXE | 18,004,480 字节 | `46eae20550f99877cfa112bbdb0d9c316758b43ad829c0185623a51b8bca761c` |
| 原数据候选 EXE（未启动） | 18,004,480 字节 | `2647819d9f82a6be0f6f393fef6f136c8987102a7e72fc9a3c63aac578422b1d` |

重复构建到同一目录按预期拒绝，原数据候选传入自动验证脚本也按预期拒绝；
两种拒绝均发生在构建 / 启动前。原调试 EXE 已恢复为隔离测试 hash，防止
旧验证脚本误启动原标识版本。构建仅使用现有调试缓存，避免重建已清理的
release 依赖；不新增生产依赖。
