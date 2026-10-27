# V1 最终源码核对

日期：2026-10-22。源码核对与运行验证分别记录；下方历史定向批次不相加，也不代替统一测试或桌面实机结果。

## 最新验证状态

- FINAL 24 组源码覆盖已完成；启动 / 评估最后一批开发已接入，当前不再列新增功能开发待办，统一测试暴露缺陷则修复并重跑。
- 最终全量：165 文件、1339 项全部通过，0 失败 / 0 跳过，耗时 724.28 秒；报告 `full-scoped-queries.json`。功能源码和本机统一回归已收尾，不等于全部发布条件已满足。
- 原生 Rust 27 项测试全通过，包括隔离 SQLite 的恢复 / 回滚 / 安全副本及版本 15–52 数据兼容；没有使用正式用户数据库。
- 历史全量：首轮 1335 项中 1297 通过 / 38 失败，第二轮 1331 通过 / 4 失败；第三轮 1339 项中 1322 通过 / 17 失败；第四轮 1338 通过 / 1 项替换模板服务测试超时。修正模板读取等待、限定按钮查询区域并等待新服务读取发出后，最终全量通过，原超时用例约 2.2 秒。未放宽默认超时或关闭测试隔离，最终运行不并行桌面测试 / Rust 构建；原失败报告保留。下表仅为原定向批次历史，不覆盖最新统一结果。
- 最终全量 lint、隔离 build、cargo check 已通过。浏览器 8 条桌面 / 4 条窄屏路线及 14 项连续操作通过，无页面异常或横向溢出；证据 `.verification/v1-20261022/`。
- Windows WebView2 114 隔离调试应用的 14 项核心操作通过；退出后只读 SQLite 校验 52 次迁移和已创建记录，重启后领域 / 目标 / 评估原文读回通过。应用标识为 `com.lifeos.verification20261022`，正式用户库未访问。
- 61 个目标、601 条行动、122 条复盘和 1096 条指标记录下，三页打开均低于 1 秒（单机样本，不承诺性能上限）。Ctrl+K、Escape 焦点恢复、四主题和 960×624 / 1.25 像素倍率模拟视口通过；模拟不等于真实 Windows 125% 系统缩放。
- WebView2 禁用网络后重载嵌入式页面、读取领域、快速记录保存及收集箱读取通过；退出后只读隔离 SQLite 确认离线记录仍存在。这不是操作系统全网断开或其他设备测试。
- 新免安装输出已构建：`portable/v1-20261022/test` 为隔离测试版，`user-data` 为原数据候选版，均未签名调试构建。隔离版 hash 校验后原生启动通过，当前系统因子为 1（100%）、1200×780，无页面异常 / 横向溢出；真实 125% 仍未验证。原数据版不自动启动，正式用户库与旧 EXE / dist 保持不动。
- macOS 架构复核完成，见 `V1_PORTABLE_DELIVERY.md`。按 FINAL 工程 §13.7，本阶段只要求架构检查；macOS 实机 / 正式分发未测，但不再列为本阶段必做缺项。
- 交付时新增 Vite `portable` 监听排除及一项回归，防止 Windows 运行中 EXE 引发 EBUSY。该文件 3 项、再次 lint / 隔离 build / cargo check 通过；预览和新隔离 EXE 并行复跑通过。新增这一项未重新并入此前 1339 项全量报告，不宣称全量 1340 项已运行。

## FINAL 功能覆盖

本表按产品功能归组，不用旧 44 / 56 验收项或等权百分比衡量开发进度。已沿页面调用追踪到应用服务、领域规则及明确仓储；表中的用例是对应回归入口，不表示本次统一运行已经通过。迁移按模块逐步增加，目前为 0052；不要求一个概念对象对应一张同名表。

| 功能与规范 | 已接入的交互 / 规则 / 持久化证据 | 回归入口 |
| --- | --- | --- |
| 首页生活语境，产品 §5 / UIUX §2–4 | `LandscapePage` / `LandscapeContextSection` / `LandscapeFactsSection`；可选状态、阶段、重心、张力，领域节点及方向 / 注意 / 趋势 / 复盘按层级呈现；`LandscapeContextService` → `SqliteLandscapeContextRepository`（0052）和 SQLite 景观偏好 | `v1-landscape-context`、`v1-landscape-facts`、`v1-landscape-read-lifecycle`、`landscape-interface` |
| 领域创建与管理，产品 §6.2 / UIUX §6 | 首页添加及推荐领域入口，`DomainEditorDialog` / `SetupDomains` / `LandscapeSettings`；颜色 / 图形 / 期待、改名、排序、有限位置、暂停 / 归档保留关系；`LifeDomainService` → `SqliteLifeDomainRepository` | `recommended-domains`、`v1-domain-templates`、`v1-domain-order`、`v1-landscape-position` |
| 领域上下文，产品 §4 / UIUX §5、13 / IA | `DomainContextPage` 汇总原记录，模块链接携带 domain，失效上下文须明确清除；各模块全局可达；强归属用外键，跨领域用专门关联表，不复制模块实例 | `v1-domain-navigation`、`v1-domain-summary-sources`、各模块领域关联用例 |
| 满意度与每日状态，产品 §6.2 / 工程 §5.2 | `MetricsPage` / `DomainMetricsSection`；自定义指标支持 0..N 领域及真实日期 / 单位，满意度明确选择已有指标或不评分；`DomainMetricService` → 指标仓储和 0051 选择关系，不自动生成人生总分 | `v1-global-metrics`、`domain-metrics`、`v1-domain-satisfaction`、`v1-domain-recent-trends` |
| 人生导航与角色，产品 §6.1、14 | `LifeNavigationPage` / `IdentityRolesPage`；使命 / 价值 / 长期方向 / 原则与角色独立保存，目标 / 决策引用，角色可停用 / 归档；对应服务与明确 SQLite 仓储 | `v1-life-navigation`、`identity-roles`、`identity-role-backup`、导航历史 / 导出用例 |
| 目标层级、模板、关系、生命周期，产品 §7 / UIUX §11 | `GoalsPage` / `GoalDetailPage` / 分区编辑器；年度方向、父子层级、三档优先级、四模板及自定义、支持 / 依赖 / 冲突 / 相关、暂停 / 放弃原因与历史；`GoalService` → `SqliteGoalRepository` | `v1-goal-hierarchy`、`v1-goal-direction`、`v1-goal-relations`、`v1-goal-lifecycle`、目标模板用例 |
| 自动进度，产品 §7 / 工程 §5.4 | `domain/progress` 纯函数；SMART / OKR 进度项、下级权重、指定习惯周期、探索型可不显示百分比；进度编辑调用 `GoalProgressItemService`，目标和新进度项原子创建 | `v1-goal-progress`、`v1-goal-progress-items`、`v1-contribution-weights`、习惯 / 探索进度用例 |
| 行动与调整反馈，产品 §7 / 工程 §7.3 | `ActionEditorDialog` 与目标 / 日历同一行动模型；独立行动、领域、计划 / 截止日期、实施意图及备用方案、结果 / 分钟 / 收获 / 问题 / 原因 / 调整；`ActionService` → 行动与计划 / 完成 / 状态历史事务 | `v1-action-details`、`v1-action-history`、`action-plan-history`、`v1-action-validation`、保存保护用例 |
| 日历，产品 §8 / UIUX §14 | `CalendarPage` / `domain/planning/Calendar`；默认 Agenda，Week / Month 辅助，同一源行动、目标期限、习惯安排 / 实际打卡、复盘、事件；无独立 Today 或预约引擎 | `v1-calendar`、`v1-calendar-lifecycle` |
| 五周期复盘，产品 §9 / UIUX §12 | `ReviewsPage` / `ReviewEditorDialog` / `ReviewFactService`；日周月季年独立结构，事实草稿可改 / 删，月季年叙事，原模板快照与答案 / 目标 / 问题 / 领域原子保存，允许断档 | `v1-review-structure`、`v1-review-facts`、`v1-strategic-review-facts`、复盘存储 / 备份 / 请求用例 |
| 快速记录与收集箱，产品 §10 / UIUX §9 | `AppShell` → 底部 `QuickCapture` → `InboxService`；先记录后分类，规则建议日期 / 关键词 / 已有对象，显式确认七类转换、固定目标标识可续做，不自动改正式数据 | `inbox-suggestions`、`v1-inbox-suggestion-sources`、`v1-capture-habit-save-lifecycle`、`inbox-dialog` |
| 问题追踪，产品 §11 | `IssuesPage` / `IssueEditorDialog`；首次发现、次数、领域 / 目标、假设 / 尝试 / 跟进 / 状态；`IssueService` → `SqliteIssueRepository`，已提交复发但刷新失败不再增量 | `issues`、`v1-issue-decision-save-lifecycle`、问题模板用例 |
| 决策档案，产品 §11 / 工程 §17 | `DecisionsPage` / `DecisionEditorDialog`；普通 / 重大、背景 / 选项 / 约束 / 风险 / 机会成本 / 可逆性 / 选择 / 理由 / 执行 / 结果 / 复盘；引用导航、目标、领域、人物、资源，明确仓储关系 | `decisions`、`v1-decision-navigation`、`v1-decision-people`、`v1-decision-resources` |
| 习惯，产品 §8、11 | `HabitsPage` / `HabitEditorDialog`；轻量打卡及可选阻碍 / 调整、稳定情境 / 触发、明确频率和完整周口径；缺记录不补零；`HabitService` → 定义 / 领域 / 打卡仓储 | `m7-habits`、`v1-habit-period-progress`、`v1-habit-templates`、习惯保存 / 导出 / 注意用例 |
| 人物、事件、能力，产品 §11 | `LifeRecordsPages` 分区阅读 / 编辑；生日、最多 20 个命名日期及原 importantDate、共同经历 / 最近联系 / 关系状态；事件明确人物 / 目标 / 领域；能力水平 / 路径 / 练习 / 复盘；`LifeRecordsService` → 原子 SQLite 仓储，0050 捕获实际关系变化 | `m7-records`、`v1-person-dates`、`v1-person-events`、`v1-records-page-lifecycle`、关系历史用例 |
| 资源引用与缺口，产品 §11 / 工程 §7.7 | `ResourcesPage` / `ResourceService` / `ResourceFacts`；时间、精力、能力、人物、财务、工具六类需求，目标或决策强归属，引用原人物 / 能力 / 指标事实，不另建余额 / 文件目录 / 库存 | `v1-resource-facts`、`v1-resource-ownership`、`v1-resource-reference`、`v1-resource-export` |
| 人生时间线与版本历史，产品 §11、14 | `LifeRecordsPages` / `GoalTimeline` / `DomainTimeline` / `PersonRelationshipTimeline` / `VersionHistoryPage`；事件 / 完成 / 复盘节点与真实目标 / 阶段成果 / 领域 / 关系变化，明确历史仓储和原记录链接；不回填假历史 | `v1-goal-timeline`、`v1-domain-history`、`v1-person-relationship-history`、`v1-version-history-source` |
| 注意事项与提醒配置，产品 §12 / UIUX §15 | `AttentionPage` / `AttentionSettingsEditor` / `AttentionService`；停滞、重复未完成 / 原文原因、领域下降、习惯下降、计划扰动、资源缺口、事件、复盘草稿及显式周期节点；独立启停 / 范围 / 阈值、展开证据，规则不输出因果 / 建议 | `attention`、习惯 / 资源 / 事件 / 复盘注意用例、`v1-settings-reminders`、`v1-reminder-settings-lifecycle` |
| 基础分析，产品 §11 / UIUX §16 / IA | `AnalyticsPage` / `AnalyticsService` / `AnalyticsComparison` / `MetricTrendView`；全局 / 单领域 / 多领域 / 目标 / 时间过滤、同比周期事实、原始来源 / 数值 / 单位，共享记录不跨领域合计，空记录不造图 | `analytics`、`v1-analytics-comparison`、`v1-supporting-analytics-facts`、`v1-metric-trend-scale` |
| 显式 AI 上下文导出，产品 §13 / UIUX §23 | `ContextExportPage` / `ContextExportService` / `domain/export`；目标 / 复盘 / 领域 / 决策 / 问题 / Inbox 场景，Markdown / Text / JSON，字段 / 分段 / 问题及日期 / 领域 / 目标 / 类型 / 隐私过滤、预览确认；关联标题遵守可见范围，无直接 AI API | `context-export`、`v1-export-source-lifecycle`、`v1-export-template-requests`、各模块导出用例 |
| 模板与搜索命令，产品 §14 / UIUX §8、22 | `TemplatesPage` / `TemplateService` 支持七类别、复制 / 修改 / 创建及五周期默认，变更不影响实例；`SearchPage` / `SearchService` 检索主要对象和过滤，低强调入口、Ctrl/Cmd K、斜杠 / 中文动作词、停用能力过滤 | `m6`、模板规则 / 请求 / 默认用例、`v1-search-commands`、`v1-search-source-lifecycle` |
| 初始化、设置、主题、导航，产品 §14 / UIUX §10、17、22 | 六步 `SetupPage` 支持稍后继续和修改；设置共用领域 / 角色 / 导航 / 模板 / 景观 / 提醒 / 模块 / 导出入口，四主题不改模块身份；导航默认收起、二级导航、常用固定；metadata 持久化，关闭模块不删事实 | `setup-progress`、`v1-settings`、`v1-navigation-preference`、主题 / 模块 / 初始化生命周期用例 |
| 系统成效与数据质量，产品 §18、16 | `SystemAssessmentPage` / 服务 / 专门仓储，月 / 季五项结果与下期调整、仅列可查事实；`DataQualityPage` / `DataQualityService` 只读检查 17 类对象与关联 / 日期 / 重复 / 结构，不自动修复数据 | `v1-resource-assessment-lifecycle`、`v1-data-quality`、`v1-data-quality-source` |
| 本地启动与完整备份，产品 §14 / 工程 §6 | Provider → bootstrap / migration → SQLite；Tauri 只承担插件、原子事务和备份；完整备份版本 15–52 预检 / 替换 / 自动安全副本 / 回滚，配置 / 原文 / 关联 / 隐私保留，旧版缺字段不补造；浏览器为内存预览不是持久库 | `desktop-bootstrap`、`v1-provider-initialization-lifecycle`、`backup-service`、迁移 / TS 备份 / `src-tauri/src/backup.rs` 原生用例 |

### 核对结论

- 上述 24 组功能均已有代码链路，不再列作待开发；统一验证正在收口。没有发现新的明确 FINAL 功能缺项，若统一测试暴露缺陷则修复后重跑。
- 概念模型差异不作为缺项：满意度复用明确指标选择；当前阶段为可选生活语境文字；关联以强语义外键和专门领域关系实现；资源领域继承其强归属目标 / 决策；插件骨架按工程 §3.3 / §18 保持服务与仓储边界，不加通用插件运行时。
- UI 源码可见弱容器、只读目标侧栏、完整页分区编辑、固定模块身份、多主题及 `prefers-reduced-motion`。源码存在不代表各视口视觉合格，也不把浏览器页面当作 Windows WebView2 / 125% 实机结果。
- 原生恢复、隔离桌面运行、WebView2 离线读写和代表性数据量已产生通过证据；最终全量结果单独记录，不再使用“最终字段核对”作为无限期未开发项目。安装 / 卸载暂按用户要求延后，macOS 仅架构兼容。

## 本轮已处理差异

| FINAL 要求 / 契约 | 源码依据与处理 | 状态 |
| --- | --- | --- |
| UIUX §11：完整目标详情默认阅读、分区就地编辑 | `src/pages/GoalDetailPage.tsx` 保留分区表单；编辑会话固定原目标和候选数据，服务 / 路由变化、读取失败不卸载同页草稿 | 开发已接入，待统一测试 |
| 保存失败不丢草稿；不能重复提交或误写另一目标 | `GoalSectionEditor.tsx`、`GoalProgressSectionEditor.tsx`、`GoalEditorDialog.tsx`、`GoalProgressDialog.tsx` 固定原记录 / 原服务，同步提交锁、字段 / 取消保护、最新仍挂载回调；方向候选使用打开时服务 | 开发已接入，待统一测试 |
| 已成功保存不因额外刷新失败再次持久化 | 详情进度项直接消费 `GoalProgressItemService.replace` 返回的已保存列表，不再保存后重读；详情按服务 / 目标 / 请求代次隔离读取与回写 | 开发已接入，待统一测试 |
| 中文可操作校验与存储异常分离 | 目标纯输入设置、关系 / 缺失目标 / 领域使用 `GoalValidationError`；进度项使用 `ProgressItemValidationError`；底层异常只显示中文重试提示 | 开发已接入，待统一测试 |
| UIUX §16：Analytics 精确刻度、数值 / 单位 / 来源 | `src/components/analytics/MetricTrendView.tsx` 新增原数值刻度及范围内的零参考线；常量 / 单点保留可用刻度，空记录不造图；窄屏使用局部横向滚动 | 开发已接入，待统一测试 / 视觉检查 |
| 日历原始打卡来源准确 | `src/domain/planning/Calendar.ts` 实际打卡直达编码后的 `habit-log`，每周安排仍链接习惯定义；`HabitsPage.tsx` 已有原记录锚点及解码定位 | 开发已接入，待统一测试 |
| UIUX §10：常用能力固定与当前模块二级导航 | `src/app/AppShell.tsx`、`NavigationCatalog.ts` 与 `ModuleSettings.tsx` 沿用 SQLite 配置、模块启停和领域上下文，保存固定 / 展开偏好 | 已接入，导航 / 模块 11 项定向检查通过，待统一测试 |
| 习惯 / Inbox / 快速记录可靠保存 | 原对象 / 服务快照、同步防重、字段 / 关闭保护、失败草稿、读取来源及卸载保护已接入；存储异常中文脱敏 | 相关 6 文件 82 项定向检查通过，待统一测试 |
| 旧迁移不丢隐私事实 | `src/db/migrations/0046-v1-inbox-record-targets.ts` 保留 privacy_level；`MigrationRunner.ts` 对已受损 0046 缺列库在写入前拒绝继续 | 隔离 SQLite 定向检查通过；已丢失值须由迁移前备份恢复 |
| 问题 / 决策原保存归属与复发次数 | 两类编辑器固定原记录 / 服务 / 候选，页面在加载 / 失败 / 失效入口保持草稿；复发已写入但读取失败只允许重读，旧来源不刷新新来源 | 17 项定向生命周期检查通过，待统一测试 |
| 目标 / 复盘列表不丢草稿或误消费入口 | `GoalsPage.tsx`、`ReviewsPage.tsx` 保持编辑器外层稳定挂载，读取绑定来源 / 代次，空领域与无效状态明确恢复；候选 / 服务固定，URL 重复参数 / hash 保留，取消加载中默认模板不重开 | 新增 15 项页面检查、目标请求 14 项及复盘请求 26 项通过，待统一测试 |
| 人物 / 事件 / 能力可靠保存与范围不扩大 | `LifeRecordsPages.tsx` 固定编辑会话的原类型 / 记录 / 服务 / 候选，读取来源与代次隔离；加载 / 失败 / 失效入口保持分区草稿，空领域 / 人物必须明确恢复，旧归档完成不重读新来源 | 新增 23 项生命周期检查；日期与人物事件相关首批 48 项通过，待统一测试 |
| 三种历史不混用读取来源 | `useTimelineRead.ts` 复用只读生命周期，目标 / 领域 / 关系历史绑定服务及重读代次，替换服务立即隐藏旧事实，保留原历史范围与来源链接 | 新增 9 项来源检查；人物记录与三种历史 6 文件 63 项通过，待统一测试 |
| 模板保存不丢草稿 / 不重复已提交写入 | 模板中心固定原草稿 / 服务、同步锁及字段保护，默认设置失败选择可重试 / 撤销；专用校验错误与提交后重读错误区分，默认不可用引用须明确替换 | 相关 5 文件 60 项通过，待统一测试 |
| 修改历史不混用对象与历史服务 | `VersionHistoryPage.tsx` 按对象服务 / 历史服务 / 类型 / 标识 / 代次读取；旧事实立即隐藏，损坏行动快照局部容错，存储错误脱敏 | 相关 4 文件 31 项通过，待统一测试 |
| 搜索领域上下文和读取来源准确 | `SearchPage.tsx` 来源 / 代次隔离，同页领域跟随 URL，空 / 失效领域明确恢复，操作候选不消费无效上下文；本地筛选、重复参数与 hash 保留 | 相关 2 文件 15 项通过，待统一测试 |
| 注意事项来源 / 领域 / 设置提交准确 | `AttentionPage.tsx` 来源 / 重读隔离，空 / 失效领域显式恢复；原设置选择 / 原服务、同步锁、失败重试 / 撤销及已提交后只重读；规则入口补无效时钟保护 | 相关 6 文件 80 项通过，待统一测试 |
| 数据质量不混用来源或旧健康结论 | `DataQualityPage.tsx` 报告绑定服务 / 重查代次，立即隐藏旧报告，类别保留，旧请求 / 离页回写隔离，仍然只读 | 相关 2 文件 19 项通过，待统一测试 |
| 导出范围、预览确认与隐私写入准确 | `ContextExportPage.tsx` 绑定服务 / 重读代次与完整预览上下文；空 / 失效领域和目标显式恢复，原服务失败隐私选择可重试 / 撤销，已提交后只重读 | 相关 3 文件 58 项通过，待统一测试 |
| 模板请求不能更改原导出范围或套用旧来源 | `useExportTemplateRequest.ts` 绑定模板服务 / URL / 重试代次；模板-only 入口继承范围，消费保留原领域 / 重复参数 / hash，空模板明确取消 | 已纳入上述 58 项定向检查，待统一测试 |
| 产品 §6.2、UIUX §13：可选满意度 / 自定义评分 | `DomainSatisfaction.ts`、`DomainMetricsSection.tsx` 明确选择本领域已有指标或不评分；迁移 0051 独立选择关系，原记录及自定义单位复用，不自动推导、不回填、不生成总分 | 已接入；领域相关首批 7 文件 107 项通过，待统一测试 |
| 满意度选择迁移 / 备份 / 导出保留真实归属和隐私 | 复合外键保证指标明确关联领域；TS / Rust 备份支持 51，旧版选择留空；导出只保留隐私、日期、类型及范围允许的指标选择，不复制评分到领域字段 | TS / 隔离 SQLite 定向检查通过，Rust / 原生恢复尚未运行 |
| 领域编辑不丢草稿、不误写替换来源 | 领域 / 指标编辑器固定原对象、原服务及候选，父级加载 / 失败保留原编辑器，读取来源 / 代次隔离；满意度提交后直接消费已保存选择，不重复持久化 | 已纳入上述 107 项定向检查，待统一测试 |
| UIUX §13：活跃目标与重要人物 / 事件原记录 | `DomainContextPage.tsx` 先按 active 过滤再截取目标摘要；行动仍按原目标领域继承；人物 / 事件 / 能力展示原名及编码来源，停用能力仅隐藏链接、不删事实 | 已纳入上述 107 项定向检查，待统一测试 |
| UIUX §13 / 工程 §7.1：普通领域页面柔和近期趋势 | `DomainMetricTrend.ts` 计算含当天的 30 个日历日；领域指标复用 `MetricTrendView` 紧凑视图，精确刻度仍留在 Analytics，真实记录 / 单位 / 来源不变，空记录不造图 | 最终领域 / 趋势 9 文件 117 项通过，待统一测试 / 视觉检查 |
| 产品 §5、UIUX §2 / §4、工程 §7.1：整体状态、当前阶段 / 重心、生活张力 | `LandscapeContextSection.tsx` 首页中文就地编辑，`LandscapeContextService.ts` / 明确仓储保存可选原文，迁移 0052 单例无种子；不推断指标、不新增未来阶段模块 | 已接入，相关 7 文件 37 项通过；待统一测试 / 视觉检查 |
| 生活语境备份完整且旧版不补造事实 | `LandscapeContextBackup.ts` 与 Rust 备份支持 52，校验单例 / 字段 / 日期 / 长度并保留原文，旧版恢复留空；不自动加入 AI 上下文导出 | TS / 隔离 SQLite 已定向检查；Rust / 原生恢复未运行 |
| 首页领域 / 事实与景观设置不混用来源 | 首页及摘要来源 / 代次隔离；推荐领域和显示偏好固定原服务 / 候选 / 草稿，同步锁、保存保护、失败选择 / 显式撤销，保存后不额外重读 | 已纳入上述 37 项；末次读取清理仅 eslint 检查，待统一测试 |
| 零领域不阻断独立目标 / 行动 / 复盘 | `LandscapePage.tsx` 在领域读取成功后即可显示已有独立事实；`LandscapeFactService.ts` 保持隐藏 / 暂停领域关联排除，不扩大关联范围 | 本批 4 文件 33 项定向检查包含对应回归，待统一测试 |
| 产品 §5 / UIUX §4：首页状态、阶段 / 周期 / 重心优先 | `LandscapeFactsSection.tsx` 在同一次来源隔离读取下，将当前周期 / 关注置于生活状态之后、景观之前，其余事实按方向 / 注意 / 趋势 / 复盘排序 | 本批 4 文件 33 项通过，含 DOM 顺序；视觉检查待统一执行 |
| 首页复盘入口打开正确周期且不自动写入 | `reviewCreatePath` 验证并编码显式 weekly / 当天请求；缺少本周记录时打开全局待确认草稿，已有记录直达原标识，停用复盘不显示入口；不虚构未来预约或催办 | 已纳入上述 33 项，含跨页打开 / 取消不写入；待统一测试 |
| 资源范围、原草稿与已保存状态准确 | `ResourcesPage.tsx` 读取绑定来源 / 代次，空领域 / 目标 / 决策不扩大为全局，原编辑服务 / 候选保持；旧保存不重读新来源，状态保存消费返回记录不额外重读 | 新增 7 项；相关 5 文件 38 项通过，含既有评估、归属、资源事实与 SQLite 引用检查；待统一测试 |
| 工程 §6.2：备份确认只能用于原文件 / 原来源 | `BackupPage.tsx` 来源会话绑定预检 / 确认，来源或环境切回不复活；同步防重与完整选择保护，晚到读取和离页下载忽略，平台错误中文脱敏 | 备份 3 文件 25 项通过，纳入本批 9 文件 87 项；待统一 / 原生测试 |
| 已提交恢复不能因重载失败再次恢复 | `BackupService.ts` 重检原对象；页面提交、回执存储与 `reloadApplication` 分开，当前成功后仅重载，离页保留安全快照回执、返回可重载 | 已纳入上述检查，使用平台模拟，不表示真实数据库恢复通过 |
| UIUX §22：初始化进度不能混用服务来源 | `SetupPage.tsx` 读取 / 保存 / 子步骤待保存绑定来源与代次，切回重新读取；失败保留步骤，旧完成不跳转，成功不额外重读 | 新增 11 项；初始化及领域设置纳入本批 9 文件 87 项，待统一测试 |
| 初始化领域排序 / 编辑草稿保持原归属 | `SetupDomains.tsx` 读取来源隔离，原排序草稿 / 原服务失败可重试或取消；编辑器稳定，旧成功不通知新页面；模板请求来源隔离、空请求明确取消 | 新增 10 项；含现有 SQLite 排序 / 模板与原编辑器检查，待统一测试 |
| UIUX §17：两处主题入口原选择与可靠保存 | `useThemePreferenceCommand.ts` 共用同步锁、原主题 / 原写入函数、失败重试 / 撤销；来源切回不复活原会话，旧成功不关闭新选择器；主题服务串行写入、失败继续，Provider 离页不发布 | 新增偏好 13 项的一部分；本批相关 9 文件 75 项通过，待统一测试 |
| 产品 §14：模块开关与导航固定失败可恢复 | 模块固定原完整偏好及明确开关选择；导航固定原命令并由既有服务重算最新已提交偏好；来源 / 离页 / 同步防重与成功反馈隔离，原失败选择可重试 / 撤销 | 已纳入上述 75 项，含既有 SQLite 偏好与导航入口检查，待统一测试 |
| 领域 override 与提醒规则原草稿归属 | `SettingsPage.tsx` 领域会话隔离；`AttentionSettingsEditor.tsx` 读取来源 / 代次、原草稿 / 原服务 / 原候选、字段 / 撤销保护与失败重试，已保存不额外重读 | 新增提醒 5 项；已纳入上述 75 项及初始化待保存联动，待统一测试 |
| 本地初始化同步防重、StrictMode 和安全错误 | `LifeOSProvider.tsx` 并发初始化共用待处理请求，重试同步保护、离页 / 替换来源隔离；`DatabaseCompatibilityError` 和 `PreferenceReadError` 仅公开固定中文安全原因，其他底层错误脱敏；不清空损坏偏好或绕过迁移保护 | 启动相关 5 文件 32 项、相关 8 文件局部 eslint 通过，待统一测试 |
| 系统成效评估来源与保存事实一致 | `SystemAssessmentPage.tsx` 读取绑定来源 / 代次，替换来源立即隐藏旧事实；原草稿 / 服务固定，明确撤销才采用新来源；成功直接消费保存结果、不额外重读，原保存不污染新来源 | 资源 / 评估生命周期 30 项及两个文件局部 eslint 通过，待统一测试 |

表中定向批次记录保留历史，其“待统一测试 / 尚未运行”不覆盖上方最新结果。目标详情、刻度、日历等回归均已纳入统一运行；定向批次仍不累加为全量统计。

## 大列表后续方案

当前代表性数据量无需为通过测试新增复杂分页组件。若实际使用出现明显等待，先在仓储接口增加按日期 / 稳定 ID 的分页，再由应用服务返回页面结果；UI 不直接执行 SQL。目标进度和复盘事实必须继续按完整事实计算，不能用可见列表页作为计算分母。仅在大批可见行成为瓶颈时引入虚拟列表，并保留来源锚点、搜索直达、键盘焦点和屏幕阅读顺序。本段为工程要求的分页 / 虚拟化计划，不宣称已实现。

## 明确未完成项

1. 真实 Windows 125% 系统缩放验证。本机窗口原生读数为 100%，未修改用户系统设置；模拟不能替代真实 125%。这是发布环境验证，不是新增功能开发任务。
2. 优化 / 签名的正式发布产物与安装 / 卸载检查仍延后。新免安装调试候选已交付，不覆盖旧版、不自动升级正式数据，不把候选构建称为正式发布。按用户要求不生成安装包；macOS 架构已复核，实机 / 分发不作为本阶段必做项。

本机统一测试、lint、隔离 build、cargo check 已完成，当前不再列为开发待办。主包约 698kB / gzip 188kB 的非阻断构建警告保留。

## 边界

最新新增迁移 0052，源码迁移 / 备份版本为 52，没有新增依赖；旧版没有满意度选择时保持不评分、没有整体生活语境时保持空白，既有 0046 修正不会自动恢复已丢失值。生活语境仅本地保存 / 完整备份，不自动导出给外部 AI。没有操作正式 AppData 数据库，没有更新既有 `dist` / 免安装 EXE 或生成安装包；新候选单独输出。日历不新增预约引擎；分析不新增人生总分或因果判断；导航不实现未来插件运行时。历史记录中的版本 50 / 51 与旧缺项仅描述当时状态，不覆盖当前实现。
