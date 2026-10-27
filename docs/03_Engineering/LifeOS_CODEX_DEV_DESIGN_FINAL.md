# LifeOS — Codex 开发设计 FINAL

> **Canonical engineering specification.**
>
> 本文件由原工程蓝图整合最终 UI/信息架构后生成。
> 工程层仍以 Tauri 2 + React + TypeScript + Vite + SQLite 为基线。
> 原设计中的 Dashboard / Widget 首页方案已被 Life Landscape + Domain Context Hub 取代。
> UI/交互细节必须以 `02_UI_UX/` 的 FINAL 文档与最终原型为准。

# **0. 执行摘要**

推荐采用 Tauri 2 + React + TypeScript + Vite + SQLite
的本地桌面架构。前端承担 UI、领域服务、规则计算和数据组织；Tauri/Rust
层尽量保持薄，只处理桌面壳、文件系统、对话框、打包等平台能力。这样既满足
Windows 优先、macOS 可兼容、本地优先，也能让 Codex 把主要开发精力集中在
TypeScript 代码上。

开发策略采用“架构完整、功能分阶段开放”。先把数据边界、模块依赖、关联模型和迁移策略设计清楚，再按里程碑逐个交付可运行功能。任何阶段都必须可启动、可测试、可回退，不允许长期停留在“半成品大分支”。

| **最重要的工程约束** LifeOS 不直接接入 AI、不依赖云端、不做多人协作；日常使用成本必须低。功能完整不等于默认界面复杂，所有高级能力都应采用渐进披露。 |
|-----------------------------------------------------------------------------------------------------------------------------------------------------|

# **1. 文档目标与输入材料**

本开发设计以两份既有方案为产品事实来源：

- 《LifeOS V1 核心设计方案》：决定 V1
  的产品定位、核心功能、使用流程和验收标准。

- 《LifeOS 后续扩展设计》：记录 V1 暂不实现但需要预留架构空间的能力。

Codex
在实现过程中应把产品方案视为“需求真源”，本开发设计视为“工程真源”。当两者出现冲突时：产品行为以核心设计方案为准；技术实现以本开发设计为准；仍有冲突时，暂停扩展范围，只实现最小、可逆、与既定原则一致的方案。

# **2. Codex 开发工作方式**

当前 Codex 官方实践强调：复杂任务先规划；项目长期规则放入
AGENTS.md；单次任务提示应明确目标、上下文、约束和完成条件。LifeOS
项目应据此建立固定工作流，而不是每次临时描述。

| **层级**          | **放什么**                                       | **不要放什么**             |
|-------------------|--------------------------------------------------|----------------------------|
| AGENTS.md         | 长期工程规则、目录结构、测试命令、禁区、完成定义 | 某个单次需求的具体实现细节 |
| docs/specs/       | 产品方案、开发设计、数据模型、ADR                | 临时聊天记录               |
| 单次 Codex 提示词 | 当前里程碑目标、相关文件、验收条件               | 重复整份产品背景           |
| DEVLOG.md         | 已完成、风险、遗留、下一步                       | 产品需求本体               |

建议所有大于一个小修复的任务都先进入计划阶段：先让 Codex
检查当前仓库、列出受影响文件和迁移风险，再开始修改。

# **3. 技术架构决策**

## **3.1 推荐技术栈**

| **层**    | **选择**                             | **理由**                                                                         |
|-----------|--------------------------------------|----------------------------------------------------------------------------------|
| 桌面容器  | Tauri 2                              | 跨 Windows/macOS；体积较轻；官方支持 Vite/React 等前端；平台能力可通过插件扩展。 |
| 前端      | React + TypeScript + Vite            | 适合复杂表单、仪表盘、模块化界面；生态成熟；Codex 处理 TS/React 效率高。         |
| 样式      | CSS Variables + Tailwind CSS（可选） | 统一设计令牌；Tailwind 只作为效率工具，不把组件结构绑死。                        |
| 路由      | React Router                         | 页面分区清晰，避免自建路由。                                                     |
| 表单/校验 | React Hook Form + Zod                | 结构化表单、模板字段、输入校验适配度高。                                         |
| 状态      | Zustand（仅 UI/会话状态）            | 简单、轻；业务事实仍以 SQLite 为唯一持久真源。                                   |
| 数据库    | SQLite + Tauri SQL plugin            | 纯本地、事务成熟、可迁移；官方 Tauri SQL 插件支持 SQLite。                       |
| 日期      | date-fns                             | 周期计算、周/月/季边界处理清晰。                                                 |
| 图表      | Recharts                             | 足以覆盖趋势、完成率和对比图；V1 不做高级 BI。                                   |
| 测试      | Vitest + React Testing Library       | 覆盖领域逻辑、组件和服务。                                                       |
| 包管理    | pnpm                                 | 锁文件明确、安装快、适合未来 workspace。                                         |

| **版本策略** 除 Tauri 2 这个架构级约束外，不在文档里硬编码第三方库的小版本。项目初始化时使用当时稳定版，并提交 lockfile；之后升级依赖必须单独变更、单独验证。 |
|---------------------------------------------------------------------------------------------------------------------------------------------------------------|

## **3.2 分层架构**

**推荐依赖方向**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>UI / Pages / Components<br />
↓<br />
Application Services（用例编排）<br />
↓<br />
Domain（规则、进度算法、周期、提醒条件）<br />
↓<br />
Repository Interfaces<br />
↓<br />
SQLite Repository Adapter<br />
↓<br />
Tauri Platform Layer（文件、对话框、打包）</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

关键原则：UI 组件不能直接拼 SQL；复杂规则不能散落在页面中；SQLite
是持久化事实源，但领域层不依赖 SQLite 细节。这样 Codex
可以针对某一层修改并单独测试。

## **3.3 不采用的方案**

| **方案**                      | **V1 不采用的原因**                                                                                       |
|-------------------------------|-----------------------------------------------------------------------------------------------------------|
| Electron                      | 可行，但对单人本地 LifeOS 来说资源占用和打包体积没有明显优势；若 Tauri 开发受阻，可作为备选而非并行方案。 |
| 云数据库 / SaaS 后端          | 违背本地优先；引入账号、同步、权限和运维复杂度。                                                          |
| 直接调用大模型 API            | 违背已确认产品原则；AI 通过场景化上下文导出参与。                                                         |
| 通用低代码/数据库框架作为核心 | 容易让 LifeOS 变成数据库界面而不是有明确运行流程的产品。                                                  |
| 过早插件化每个模块            | V1 先留边界和接口，不为尚未存在的插件生态支付复杂度。                                                     |

# **4. 仓库结构**

**建议目录结构**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>lifeos/<br />
├─ AGENTS.md<br />
├─ README.md<br />
├─ DEVLOG.md<br />
├─ docs/<br />
│ ├─ specs/<br />
│ │ ├─ LifeOS_V1_CORE.md<br />
│ │ ├─ LifeOS_CODEX_DEV_DESIGN.md<br />
│ │ └─ LifeOS_FUTURE_EXTENSIONS.md<br />
│ ├─ adr/ # 重大技术决策记录<br />
│ └─ data-model/<br />
├─ src/<br />
│ ├─ app/ # 启动、路由、Providers<br />
│ ├─ pages/ # 页面层<br />
│ ├─ components/ # 通用 UI<br />
│ ├─ features/ # 按业务模块组织<br />
│ │ ├─ life-landscape/<br />
│ │ ├─ life-navigation/<br />
│ │ ├─ life-domains/<br />
│ │ ├─ goals/<br />
│ │ ├─ actions/<br />
│ │ ├─ reviews/<br />
│ │ ├─ inbox/<br />
│ │ ├─ issues/<br />
│ │ ├─ decisions/<br />
│ │ ├─ habits/<br />
│ │ └─ context-export/<br />
│ ├─ domain/ # 无 UI 的核心规则<br />
│ ├─ services/ # 用例编排<br />
│ ├─ repositories/ # 接口 + SQLite adapter<br />
│ ├─ db/ # migrations / seed / queries<br />
│ ├─ shared/ # 类型、日期、错误、工具<br />
│ └─ styles/<br />
├─ src-tauri/<br />
│ ├─ src/<br />
│ ├─ capabilities/<br />
│ └─ tauri.conf.json<br />
└─ tests/<br />
├─ unit/<br />
├─ integration/<br />
└─ fixtures/</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

features 负责模块内聚；domain 负责跨页面的稳定规则；repositories
负责持久化边界。不要用一个巨大的 services/ 或 utils/ 收纳所有逻辑。

# **5. 核心数据设计**

## **5.1 通用字段约定**

| **字段**                | **约定**                                                      |
|-------------------------|---------------------------------------------------------------|
| id                      | TEXT UUID；应用层生成，避免依赖数据库自增 ID。                |
| created_at / updated_at | ISO 8601 UTC 时间字符串；展示时按本地时区转换。               |
| archived_at             | 归档时间；归档与删除分开。                                    |
| deleted_at              | 软删除；默认查询排除，备份保留，后续可提供恢复。              |
| privacy_level           | normal / private / highly_sensitive。                         |
| version                 | 乐观版本号，用于并发/恢复检查，即使 V1 单机也有利于历史记录。 |
| extra_json              | 仅用于真正扩展字段，不把核心查询字段塞进 JSON。               |

实体状态、周期类型、目标类型等使用 TypeScript string union + 数据库
CHECK/校验层双重约束，避免魔法数字。

## **5.2 V1 领域对象**

| **对象**                        | **核心字段/关系**                                                    | **备注**                                               |
|---------------------------------|----------------------------------------------------------------------|--------------------------------------------------------|
| LifeNavigationItem              | type(mission/value/vision/principle), title, content, order          | 低频战略信息。                                         |
| IdentityRole                    | name, description, active                                            | 身份/角色视角，可关联领域和目标。                      |
| LifeDomain                      | name, current_state, long_term_expectation, order                    | 领域评分不固定，指标另表管理；支持暂停/归档。          |
| DomainLink                      | domain_id, object_type, object_id, relation_type                     | 领域与目标/行动/习惯/复盘/问题/决策/人物/事件等的 many-to-many 上下文关联。 |
| MetricDefinition / MetricRecord | scope, name, scale, weight, date, value                              | 同时服务人生领域和每日状态自定义指标。                 |
| Goal                            | parent_id, horizon, template_type, priority, status, dates, progress | 年度/季度/阶段/月度；进度由算法计算。                  |
| GoalProgressItem                | goal_id, kind, target/current, weight                                | OKR KR、里程碑、可量化结果等统一抽象。                 |
| GoalRelation                    | source_goal, target_goal, relation_type                              | support / depend / conflict / related；V1 只轻量展示。 |
| Action                          | goal_id 可空, title, planned/due, status, priority, result           | 允许独立行动。                                         |
| ActionExecution                 | action_id, result, minutes, gains, problems, adjustment              | 执行反馈历史。                                         |
| PlanChange                      | entity_type/id, before, after, reason_code, note                     | 保留原计划 → 调整后计划 → 实际结果分析链。             |
| Habit / HabitLog                | schedule, context, completion                                        | 独立于行动；轻量打卡 + 可选深度记录。                  |
| Review                          | type, period_start/end, template_snapshot, status                    | 日/周/月/季/年统一对象。                               |
| ReviewAnswer                    | review_id, field_key, value                                          | 支持结构化字段 + 自由文本。                            |
| InboxItem                       | content, source, suggested_type, status                              | 统一低成本入口。                                       |
| Issue                           | title, status, first_seen, recurrence_count                          | 长期问题跟踪，可由复盘转入。                           |
| Decision                        | importance, background, options, constraints, choice, outcome        | 普通记录可升级为重大决策档案。                         |
| Person                          | basic_info, relationship_type, important_dates, last_contact, state  | 人际关系档案。                                         |
| LifeEvent                       | date, title, description                                             | 人生时间线的重要节点。                                 |
| Skill                           | name, current_level, target_level                                    | 能力成长，不等同知识库。                               |
| Template                        | category, name, version, schema_json                                 | 复盘、目标、决策、导出等模板。                         |
| ObjectLink                      | source_type/id, target_type/id, link_type                            | 跨模块 0..N 关联的统一底座。                           |
| VersionHistory                  | entity_type/id, operation, snapshot/diff, reason                     | 关键对象变化记录。                                     |
| LandscapePreference / DomainPosition | user_pref / domain_id, x, y, display_state                         | 人生景观的有限显示偏好与领域位置，不做自由 Dashboard 卡片墙。                             |
| ReminderRule                    | scope, trigger_type, config_json, enabled                            | 默认弱提醒，自定义规则。                               |

| **不要一次建完所有表** “完整架构一次设计”不等于 M0 就创建所有未来表。概念模型先确定，数据库表随里程碑通过 migration 增加。未启用的模块不要预先制造维护负担。 |
|--------------------------------------------------------------------------------------------------------------------------------------------------------------|

## **5.3 多维关联策略**

LifeOS 的主层级仍然明确：长期方向 → 目标 → 行动；横向关系通过 ObjectLink
处理。这样既保留可理解的主线，也允许目标同时关联领域、身份、人物、问题、能力和事件。

**关联示例**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>Goal(年度目标)<br />
├─ parent_goal_id → 上层目标<br />
├─ ObjectLink → LifeDomain<br />
├─ ObjectLink → IdentityRole<br />
├─ ObjectLink → Issue<br />
├─ ObjectLink → Skill<br />
└─ Action[] → 具体行动</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

ObjectLink 不应替代所有外键：强语义关系继续用明确外键（如
Action.goal_id、Goal.parent_id）；只有真正跨模块、可选、多对多的关系使用
ObjectLink。

## **5.4 目标进度算法**

| **模板**   | **默认算法**                            | **用户可调整**         |
|------------|-----------------------------------------|------------------------|
| OKR        | 按 KR / GoalProgressItem 加权计算       | KR 权重、目标值        |
| SMART      | 按里程碑/量化结果加权                   | 里程碑权重、完成规则   |
| 习惯型目标 | 按指定周期内 HabitLog 完成率            | 目标频率、周期、权重   |
| 探索型     | 默认不强制百分比，可按探索节点/阶段成果 | 是否启用进度、节点权重 |

所有进度计算必须放在 domain/progress
中，写纯函数和测试；页面只消费计算结果。

# **6. 数据库、迁移与备份**

## **6.1 SQLite 原则**

- 所有 schema 变化必须通过有序 migration；禁止运行时“如果没有列就临时
  ALTER”式逻辑。

- 写操作尽量使用事务；创建目标及其进度项、创建复盘及答案等必须原子化。

- 删除默认软删除；用户明确永久删除时再物理删除，并先检查引用关系。

- 常用查询建立索引：status、period/date、goal parent、object
  links、searchable normalized title。

- V1 不做数据库加密，但字段和备份格式必须保留未来加密迁移空间。

## **6.2 备份/恢复设计**

V1 推荐“应用级可版本化备份”作为主方案，而不是直接让用户复制正在使用的
SQLite 文件。

**备份包逻辑结构**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>lifeos-backup.json<br />
{<br />
"format": "lifeos-backup",<br />
"schemaVersion": 12,<br />
"appVersion": "1.x",<br />
"exportedAt": "...",<br />
"data": {<br />
"lifeDomains": [...],<br />
"goals": [...],<br />
"actions": [...],<br />
"reviews": [...]<br />
}<br />
}</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

- 恢复前先校验 format/schemaVersion，并生成恢复预检报告。

- 恢复默认是“替换当前数据库”而不是隐式合并；替换前自动生成安全快照。

- 导入/恢复全过程使用事务，失败必须回滚。

- 普通业务数据导出与完整备份分开：前者面向阅读/AI，后者面向灾难恢复。

# **7. 模块实现设计**

## **7.1 首页 / Life Landscape / Domain Context**

首页不实现传统 Dashboard 卡片墙，而实现 Life Landscape。

首页优先呈现：
- 当前生活状态；
- 当前阶段 / 当前重心；
- 主要人生领域；
- 生活张力；
- 低干扰关注摘要；
- 最近趋势；
- 下一次复盘入口。

领域节点可点击进入 Domain Context Hub。领域上下文页聚合状态、长期期待、趋势以及相关能力入口。

从 Domain Context Hub 进入目标、习惯、复盘、问题、决策、人物、事件、资源、Analytics 时，只附加领域上下文筛选，不复制模块和数据。

Life Landscape 允许有限显示偏好与领域位置持久化，但不做任意 Widget 系统或多套 Dashboard 视图。

## **7.2 人生导航与人生领域**

人生导航管理使命、价值观、愿景和原则；人生领域管理状态、长期期望、自定义指标、相关目标/问题/复盘。评分只是可选信息，不生成单一“人生总分”。

## **7.3 目标与行动**

核心模块。支持层级目标、多模板、自动进度、轻量目标关系、行动可独立、完整执行反馈、计划变更历史。任何“月/周/日”视图都应由同一事实数据生成，避免复制任务。

## **7.4 复盘中心**

日/周/月/季/年统一流程。系统以规则汇总下级事实，生成可编辑草稿；模板字段 +
自由书写并存。日常允许断档，周/月复盘是主要深度入口。

## **7.5 Inbox**

统一快速输入，不要求当场分类。先做规则推荐（日期、关键词、已有对象匹配），不自动写入正式模块；用户可生成
AI 分类上下文。

## **7.6 问题与重大决策**

问题长期跟踪并统计复发；普通决策轻量记录，必要时升级为重大决策档案。决策系统展示背景、选项、约束、风险、可逆性、关联人生导航/目标/领域，并支持后续结果复盘。

## **7.7 习惯、人物、能力、事件、资源**

按阶段开放。资源模块不维护重复数据库，而是聚合时间、状态、能力、人物、财务轻量信息，做目标/决策资源缺口视图。Knowledge
Hub 不进入 LifeOS 核心。

## **7.8 规则发现与弱提醒**

只做可解释规则：例如目标连续 N
周无进展、复盘逾期、某类未完成原因反复出现。提示中必须显示触发原因和数据范围，不能伪装成智能诊断。

## **7.9 AI 上下文导出**

统一筛选/聚合引擎 +
场景化模板。目标分析、复盘分析、领域分析、问题诊断、重大决策、Inbox
分类各用不同模板。输出 Markdown / 纯文本 /
JSON；导出前可预览和过滤隐私级别。

## **7.10 搜索、模板、版本历史、设置**

全局搜索覆盖主要对象；模板变化不影响历史实例；关键对象保留版本历史；设置中心集中管理启用模块、首页、提醒、模板和导出配置。

# **8. UI/UX 约束**

本工程文档不再独立定义页面视觉细节。实现前必须阅读：
- `docs/ui/LifeOS_V1_UIUX_Spec_FINAL.md`
- `docs/ui/LifeOS_V1_Information_Architecture_FINAL.md`
- `docs/ui/LifeOS_V1_Final_Prototype.html`

强制约束：

| **约束** | **实现要求** |
|---|---|
| 双层架构 | 理解层先帮助用户理解人生；管理层再精确管理对象。 |
| Life Landscape | 首页不得退回 KPI Dashboard / Card Wall。 |
| Domain Context | 领域是上下文、模块是能力；同一对象允许关联多个领域。 |
| 新增领域 | 人生景观直接提供“＋ 添加领域”；保存后复用已有能力，不复制模块。 |
| 渐进披露 | 默认只显示高频/必要信息，高级能力按需展开。 |
| 弱容器 | 禁止 Card Everywhere，优先用排版、留白、分隔形成层级。 |
| 只读侧栏 | 右侧详情层用于预览，不做密集 Inspector Form。 |
| 就地编辑 | 完整详情页按区块 inline edit，不切换整页表单。 |
| 搜索可发现 | 搜索/命令栏弱显式但不能完全隐藏；Hover/Focus 增强。 |
| Quick Capture | 全局 + 打开底部 Composer，先记录进 Inbox、后分类。 |
| 关注中心 | 主页面安静；规则事实集中到独立 Attention Center，并可展开证据。 |
| 数据可视化 | 普通页面柔和趋势；Analytics 才显示精确刻度、基线、原始数据。 |
| 多主题 | Warm Light / Deep Black / Blue Gray Dark / Warm Dark；主题不改变模块身份。 |
| 日常 5–10 分钟 | 任何日常流程若必须填写大量文字才能完成，视为设计失败。 |
| 允许断档 | 漏填不制造失败感；周/月复盘补上下文。 |
| 不项目管理化 | 避免 Jira/Notion/Linear 式任务管理认知占据首页。 |
| 不过度量化 | 评分与图表是辅助，不代替叙事、背景和自主判断。 |
| 可解释 | 自动进度、规则提示、汇总都必须说明来源。 |

# **9. V1 开发里程碑**

| **里程碑**                | **范围**                                                                                                                           | **完成定义（DoD）**                                                     |
|---------------------------|------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------|
| M0 工程基线               | 创建 Tauri/React/TS/Vite 项目；AGENTS.md；lint/test/build；SQLite plugin；migration runner；基础 layout/router；错误边界；DEVLOG。 | pnpm test、pnpm build、tauri build/dev 基线通过；可创建并读取 test DB。 |
| M1 人生基础 + Life Landscape | 人生导航、身份角色、人生领域、自定义指标；Life Landscape；Domain Context Hub；新增/归档领域；主题基础；设置中心基础。 | 可完成初始化并进入人生景观；领域可新增并进入上下文；位置/主题偏好重启后保留。 |
| M2 目标与行动核心         | 目标模板、层级、进度项、进度引擎、优先级、生命周期、目标关系；行动、执行反馈、计划变更。                                           | 可从年度目标追踪到行动；进度自动计算；原计划/调整/实际可查询。          |
| M3 复盘闭环               | 日/周/月/季/年 Review；模板/字段；自动规则汇总；草稿可编辑；复盘关联目标/领域/问题。                                               | 周复盘能汇总一周行动、目标进度、状态和问题；用户可修改保存。            |
| M4 Inbox + 问题 + 决策    | 统一 Inbox、规则分类建议、问题追踪、普通决策升级重大决策。                                                                         | Inbox 不确定信息可转正式对象；重大决策形成完整档案。                    |
| M5 分析 + 规则发现 + 导出 | 趋势图、计划 vs 实际、规则发现、弱提醒；AI 上下文导出引擎及多场景模板。                                                            | 导出内容可预览、筛选隐私、生成 Markdown/JSON；规则提示可解释。          |
| M6 模板/搜索/版本/备份    | 全局搜索；模板中心；关键对象版本历史；完整备份恢复；导入导出中心。                                                                 | 在干净环境可通过备份恢复全部 V1 数据；搜索和历史可用。                  |
| M7 第二批模块与发布收口   | 习惯、人物、事件、能力、资源聚合；系统成效评估；可访问性、性能、Windows 打包；macOS 架构验证。                                     | Windows 安装包可长期使用；核心路径测试通过；无阻塞级数据丢失问题。      |

| **Codex 执行规则** 一次只推进一个里程碑或一个可评审子任务。不要给 Codex 一个“把整个 LifeOS 一次做完”的提示词；这会增加跨模块假设、测试缺失和返工。 |
|----------------------------------------------------------------------------------------------------------------------------------------------------|

# **10. 测试与质量门槛**

## **10.1 测试金字塔**

- Domain
  单元测试：目标进度算法、周期边界、规则触发、导出筛选、隐私过滤。

- Repository 集成测试：migration、事务、软删除、恢复、关系查询。

- Component 测试：关键表单、复盘编辑、Life Landscape、领域上下文与新增领域流程。

- 关键流程验收测试：初始化 → 建目标 → 建行动 → 执行反馈 → 周复盘 →
  导出上下文 → 备份恢复。

UI 视觉回归可以后续增强，但 V1 每次重大 UI 改动至少要人工走查 Windows
125% 缩放、窄窗口和深色/浅色（若实现）场景。

## **10.2 每次 Codex 任务的 Definition of Done**

- 代码只修改任务必要范围；没有顺手大规模重构。

- 新增/修改的领域规则有测试。

- 数据库变化有 migration，并有向前迁移测试。

- UI 空态、错误态、加载态可用。

- 不引入云端、AI API、遥测、账号体系等未授权能力。

- pnpm test、pnpm build 通过；Rust/Tauri 相关改动额外跑 cargo check /
  tauri build（按环境可行性）。

- DEVLOG.md 更新：完成内容、验证命令、已知限制、下一步。

# **11. AGENTS.md 设计**

AGENTS.md 应短而稳定，只写 Codex 每次都必须遵守的工程规则。产品长文放
docs/specs，不要复制进 AGENTS.md。下面模板可直接放到仓库根目录。

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th># LifeOS Repository Instructions<br />
<br />
## Product intent<br />
LifeOS is a single-user, local-first personal life management desktop
app.<br />
It helps the user understand current life state, connect goals to
actions,<br />
review regularly, make major decisions with better context, and detect
issues earlier.<br />
<br />
## Non-negotiable product constraints<br />
- Windows-first desktop app; architecture must remain compatible with
macOS.<br />
- Local-first. No cloud backend, account system, telemetry, or
multi-user features in V1.<br />
- Do not integrate any AI/LLM API. AI participation is only through
explicit context export.<br />
- Do not turn LifeOS into a generic project-management/Jira-style
product.<br />
- Do not over-quantify life. Scores are optional supporting data, not
the product's judgment.<br />
- Daily maintenance must stay lightweight; advanced fields use
progressive disclosure.<br />
- Knowledge Hub/file-resource catalog is a separate future system, not a
LifeOS core module.<br />
<br />
## Technical baseline<br />
- Tauri 2 desktop shell.<br />
- React + TypeScript + Vite frontend.<br />
- SQLite through the Tauri SQL plugin.<br />
- pnpm for JavaScript dependencies.<br />
- Domain rules live outside UI components.<br />
- UI components must not issue ad-hoc SQL directly.<br />
- Persisted business facts come from SQLite; Zustand or other client
state is UI/session state only.<br />
<br />
## Architecture<br />
Keep dependency direction:<br />
UI -&gt; Application Services -&gt; Domain -&gt; Repository Interfaces
-&gt; SQLite Adapter.<br />
Tauri/Rust should stay thin unless a platform capability genuinely
requires Rust.<br />
Use explicit foreign keys for strong domain relationships and ObjectLink
only for optional cross-module links.<br />
<br />
## Database rules<br />
- Every schema change requires an ordered migration.<br />
- Prefer transactions for multi-record writes.<br />
- Use soft delete for user data by default.<br />
- Never silently drop or rewrite user data during migration.<br />
- Backup/restore formats must carry schemaVersion.<br />
<br />
## Engineering rules<br />
- Before a non-trivial change, inspect the relevant specs and current
code, then present a short plan.<br />
- Keep changes scoped to the current milestone/task.<br />
- Add tests for new domain logic and regressions.<br />
- Avoid new production dependencies unless they materially reduce
complexity; explain why before adding one.<br />
- Prefer small, typed modules over large generic utils/services
files.<br />
- Preserve existing behavior unless the task explicitly changes
it.<br />
- Surface errors to the UI with actionable messages; do not swallow
errors.<br />
<br />
## Required verification<br />
At minimum after relevant changes:<br />
- pnpm test<br />
- pnpm build<br />
- pnpm lint (when configured)<br />
For Tauri/Rust changes also run cargo check and/or the appropriate Tauri
build command when available.<br />
<br />
## Definition of done<br />
A task is done only when:<br />
1. requested behavior works,<br />
2. tests cover the important rule/path,<br />
3. migrations are included when schema changed,<br />
4. build passes,<br />
5. no unrelated product scope was added,<br />
6. DEVLOG.md records what changed, how it was verified, and known
limitations.<br />
<br />
## Source of truth<br />
Read these before architecture/product decisions:<br />
- docs/specs/LifeOS_V1_CORE.md<br />
- docs/specs/LifeOS_CODEX_DEV_DESIGN.md<br />
- docs/specs/LifeOS_FUTURE_EXTENSIONS.md<br />
If requirements conflict, preserve V1 product constraints and choose the
smallest reversible implementation.</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

# **12. Codex 总控提示词（首次启动项目）**

用途：仓库刚创建或准备正式启动 LifeOS V1 时使用。建议在 Codex
的计划模式中先执行一次，确认计划后再让其开始编码。

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>你现在是 LifeOS V1
的主开发工程师。请把这个仓库当作需要长期维护的真实产品，而不是一次性
Demo。<br />
<br />
【第一步：只分析和规划，不要立即写代码】<br />
1. 阅读仓库根目录的 AGENTS.md。<br />
2. 阅读：<br />
- docs/specs/LifeOS_V1_CORE.md<br />
- docs/specs/LifeOS_CODEX_DEV_DESIGN.md<br />
- docs/specs/LifeOS_FUTURE_EXTENSIONS.md<br />
3. 检查当前仓库状态、已有代码、依赖、测试和构建配置。<br />
4. 对照开发设计中的 M0 工程基线，列出：<br />
- 当前已具备能力<br />
- 缺失项<br />
- 建议新增/修改的文件<br />
- 数据库与 migration 计划<br />
- 测试计划<br />
- 风险或需要我决定的事项<br />
5. 不要把后续扩展功能提前塞进 V1，也不要自行接入云端、AI
API、账号体系或遥测。<br />
<br />
【技术基线】<br />
- Tauri 2<br />
- React + TypeScript + Vite<br />
- SQLite（Tauri SQL plugin）<br />
- pnpm<br />
- 业务规则放 domain/application 层；UI 不直接写散落 SQL；Tauri/Rust
层保持薄。<br />
<br />
【产品约束】<br />
- 单人、本地优先、Windows 优先兼容 macOS。<br />
- 不直接接入 AI；AI 只通过场景化上下文导出参与。<br />
- 不把产品做成 Jira/任务管理器。<br />
- 功能完整但默认交互必须轻量，日常维护目标 5–10 分钟，允许断档。<br />
- 评分和数据只是辅助，不能形成“系统替用户评价人生”的体验。<br />
<br />
【本次目标】<br />
先完成 M0 工程基线，不实现 M1 之后的业务模块。<br />
<br />
【完成条件】<br />
- 项目能在开发环境启动。<br />
- 基础路由/Layout 可用。<br />
- SQLite 连接与 migration runner 可验证。<br />
- 有至少一个最小 repository/domain 测试样例，证明分层结构可测试。<br />
- pnpm test 与 pnpm build 通过；Tauri/Rust 相关配置按环境执行 cargo
check/tauri dev 或说明限制。<br />
- 创建/更新 DEVLOG.md，记录完成内容、验证命令、已知限制和下一步。<br />
<br />
先输出你的实施计划。除非发现会改变架构的重大冲突，否则不要因为小细节停住；采用最小、可逆的实现并在计划中说明。</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

# **13. 分阶段 Codex 提示词**

## **13.1 M1：人生基础 + Life Landscape**

实现 M1“人生基础 + Life Landscape”。

目标：
- 实现人生导航（使命/价值观/愿景/原则）的基础 CRUD。
- 实现身份角色与人生领域。
- 实现可自定义的领域/每日状态指标定义与记录。
- 实现 Life Landscape 首页骨架。
- 实现 Domain Context Hub。
- 实现“＋ 添加领域”轻量创建流程。
- 实现领域改名、排序/位置、暂停、归档的基础数据能力。
- 实现 DomainLink many-to-many 关联基础设施。
- 实现 Warm Light / Deep Black / Blue Gray Dark / Warm Dark 主题基础。
- 实现推荐模板 + 引导式初始化的最小闭环。

约束：
- 不实现传统 Dashboard Widget 系统。
- 不实现目标/行动、复盘、AI 导出等 M2+ 完整业务能力，只做必要占位与关联边界。
- 不生成单一“人生总分”。
- 指标与业务对象必须允许 0..N 个领域关联。
- 领域不是树状父级；模块后续将作为全局 Capability，通过 Domain Context Filter 进入。
- 高级字段默认折叠，保持首次使用轻量。
- 搜索/命令栏弱显式但可发现。
- 新增领域必须从 Life Landscape 可进入，不得只藏在设置中。

验收：
- 完成初始化后看到 Life Landscape。
- 点击领域进入 Domain Context Hub。
- 新增领域后立即出现在景观，并能打开自己的上下文页。
- 领域暂停/归档不丢历史。
- 主题切换并持久化。
- migration、测试、构建通过。
- 更新 DEVLOG.md。

## **13.2 M2：目标与行动核心**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>实现
M2“目标与行动核心”。先阅读目标/行动相关产品要求与现有数据模型，再给出计划。<br />
<br />
必须实现：<br />
- 目标层级：长期方向关联 -&gt; 年度 -&gt; 季度/阶段 -&gt;
月度重点；周/日以行动为主。<br />
- 目标模板：OKR / SMART / 习惯型 / 探索型，统一 progress
engine，模板决定默认算法，允许用户改权重。<br />
- 优先级：高/中/低。<br />
-
生命周期：候选、进行中、暂停、完成、归档、放弃；暂停/放弃要记录原因。<br />
- 目标横向关系：support / depend / conflict / related，仅轻量列表
UI。<br />
- 行动允许 goal_id
为空；完整执行反馈包括实际结果、投入时间、收获、问题、后续调整。<br />
-
计划变更历史：保留原计划、调整后计划、调整时间、原因和最终实际结果。<br />
<br />
验收：<br />
- 从年度目标可以追踪到当前行动。<br />
- 自动进度算法有纯函数单元测试。<br />
- 计划变更可用于后续“计划 vs 实际”统计。<br />
- migration 可重复在空数据库执行。<br />
- 不实现复杂关系图谱或高级指数模型。</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## **13.3 M3：五级复盘闭环**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>实现 M3“复盘闭环”。<br />
<br />
目标：<br />
- 统一 Review 模型支持 daily / weekly / monthly / quarterly /
annual。<br />
- 复盘采用“结构化字段 + 自由书写”。<br />
-
模板必须可版本化；历史复盘使用当时模板快照，不因模板后来修改而变化。<br />
-
上一级复盘草稿从下一级数据、行动、目标进度、状态指标、问题记录中按规则汇总。<br />
- 自动汇总只生成事实草稿，用户可编辑/删除/补充，不使用 AI。<br />
- 日常允许断档；周/月复盘可在缺失数据时继续进行。<br />
<br />
每日默认字段至少覆盖：完成了什么、未完成、未完成原因、状态、收获、明日调整、目标是否调整。<br />
周复盘覆盖：执行总结、目标进度、反复问题、下周重点、人生领域状态。<br />
月/季/年复盘逐步提高战略层级，不只是扩大日期范围。<br />
<br />
验收：做完一周数据后，周复盘能自动形成可编辑事实草稿，并能关联目标/领域/问题。</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## **13.4 M4：Inbox / 问题 / 决策**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>实现 M4“统一 Inbox + 问题追踪 + 决策档案”。<br />
<br />
Inbox：<br />
- 快速记录内容，不强制分类。<br />
- 状态：未整理/已整理/归档。<br />
- 规则推荐只做可解释启发式：日期、关键词、已有对象匹配等。<br />
- 不允许规则自动修改正式模块。<br />
- 支持把 Inbox 项转换成目标/行动/问题/事件/决策议题等。<br />
<br />
问题：<br />
-
记录首次发现、关联对象、复发次数、原因假设、已尝试方案、状态和后续复盘。<br />
<br />
决策：<br />
- 普通决策轻量记录；可升级为重大决策。<br />
-
重大决策包含背景、选项、约束、评价维度、风险/机会成本、可逆性、选择、理由、执行条件、结果和复盘。<br />
- 决策可关联人生导航、领域、目标、人物、资源。<br />
<br />
验收：从 Inbox
中的一条模糊信息可以经用户确认转成正式问题/行动/重大决策；整个过程不调用
AI。</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## **13.5 M5：分析 / 规则发现 / AI 上下文导出**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>实现 M5“分析 + 规则发现 + AI 上下文导出”。<br />
<br />
分析：<br />
- 目标完成趋势、行动完成率、计划 vs
实际、领域指标趋势、习惯/复盘/问题基础统计。<br />
- 不做复杂指数模型。<br />
<br />
规则发现：<br />
- 规则必须可解释并可配置阈值，例如“目标连续 N
周无推进”“同类未完成原因重复出现”。<br />
- 输出事实和触发依据，不输出深层原因或人生建议。<br />
<br />
AI 上下文导出：<br />
- 不接任何 AI API。<br />
- 底层共用筛选/聚合引擎，上层使用不同场景模板。<br />
- 至少提供：目标分析、周/月复盘、人生领域、问题诊断、重大决策、Inbox
分类。<br />
- 支持时间/领域/目标/对象/隐私级别过滤。<br />
- 导出前显示预览；输出 Markdown、纯文本、JSON。<br />
- 模板系统预设为主，允许用户改字段顺序和是否包含。<br />
<br />
验收：同一数据集使用不同场景模板能生成结构明显不同的上下文；private/highly_sensitive
过滤有测试。</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## **13.6 M6：搜索 / 模板 / 版本 / 备份**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>实现 M6“搜索、模板中心、版本历史、备份恢复”。<br />
<br />
必须实现：<br />
-
全局搜索覆盖目标、行动、复盘、问题、人物、事件、领域等已开放对象；支持类型、日期、状态、领域筛选。<br />
- 模板中心管理目标/复盘/决策/问题/习惯/AI
导出模板；历史实例不受模板修改影响。<br />
- 关键对象
VersionHistory；目标调整、复盘补充、问题演化、重大决策背景要可追溯。<br />
- 完整应用级 JSON
备份：format、schemaVersion、appVersion、exportedAt、data。<br />
- 恢复前预检，恢复前自动安全快照，事务回滚。<br />
<br />
不要：<br />
- 不做复杂旧系统数据迁移。<br />
- 不把业务导出和灾难恢复备份混为一个功能。<br />
<br />
验收：在全新数据库中可以从备份恢复全部已实现 V1
数据，并通过一致性检查。</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## **13.7 M7：第二批模块与发布收口**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>实现 M7 的 V1
收口能力：习惯、人物、重要事件、能力成长、资源总览/缺口、系统成效评估，以及
Windows 发布质量。<br />
<br />
关键边界：<br />
- 习惯平时轻量打卡，需要时才展开阻碍/调整分析。<br />
- 人物不是 CRM，只记录已确认字段和关系状态。<br />
- 能力模型管理“我的能力变化”，不要复制 Knowledge Hub。<br />
-
资源是跨模块聚合与缺口分析层，不重复维护人物、技能、状态、财务数据。<br />
- 系统成效评估围绕 5
个结果：更清楚人生状态、目标行动更一致、复盘更规律、重大决策更有依据、更早发现问题。<br />
<br />
发布验收：<br />
- Windows 安装/卸载、数据目录、备份恢复走查。<br />
- 核心流程无数据丢失阻塞问题。<br />
- 窗口缩放和 125% 系统缩放下界面可用。<br />
- macOS 只做架构兼容性检查，不要求本里程碑完成正式分发。</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

# **14. 常用专项提示词**

## **14.1 Bug 修复**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>请修复下面的问题，但不要先假设根因：&lt;粘贴问题&gt;。<br />
<br />
先做：<br />
1. 复现或根据日志定位失败路径。<br />
2. 找到最小根因和受影响范围。<br />
3. 说明是否涉及数据迁移/兼容性。<br />
4. 写一个能在修复前失败、修复后通过的回归测试。<br />
<br />
然后实施最小修复。不要借机重构无关模块。最后运行相关测试与构建，并说明根因、修改文件、验证方式和仍存在的风险。</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## **14.2 代码审查**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>请以 LifeOS 的 AGENTS.md、V1 产品约束和当前里程碑 DoD
为标准审查这次改动。<br />
<br />
优先寻找：<br />
- 数据丢失或 migration 风险<br />
- UI 直接访问数据库 / 分层破坏<br />
- 目标进度、周期、日期边界错误<br />
- 隐私过滤遗漏<br />
- 模板修改影响历史实例<br />
- 新依赖是否必要<br />
- 测试是否真正覆盖行为而不是实现细节<br />
- 是否偷偷扩展了 V1 范围<br />
<br />
按严重程度列出问题，并给出具体文件/代码位置和最小修复建议。不要为了“有建议”而制造风格问题。</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## **14.3 重构**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>我要重构 &lt;模块/文件&gt;，目标是 &lt;目标&gt;。<br />
<br />
请先证明当前行为边界：列出公共
API、持久化格式、关键测试和被依赖方。先补足必要回归测试，再重构。<br />
<br />
约束：<br />
- 不改变产品行为和数据库语义，除非我明确要求。<br />
- 不同时重构多个无关模块。<br />
- 如需改变 schema，必须单独 migration 并说明回滚/恢复风险。<br />
- 完成后给出“行为未变化”的验证证据。</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## **14.4 数据库迁移**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>请为下面的数据模型变化设计并实现 migration：&lt;变化说明&gt;。<br />
<br />
要求：<br />
- 先分析当前 schema 和历史 migrations。<br />
-
说明向前迁移策略、现有数据转换、空值/默认值、索引变化、失败回滚风险。<br />
- 不静默丢弃现有用户数据。<br />
- 增加 migration 集成测试：空数据库 + 含旧数据数据库。<br />
- 如无法安全自动迁移，宁可保留旧字段并分两阶段迁移。</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## **14.5 UI 功能实现**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>实现 &lt;页面/功能&gt;，但先从使用成本而不是字段完整度出发。<br />
<br />
要求：<br />
- 默认界面只显示高频核心信息；高级字段渐进披露。<br />
- 必须有空态、错误态、保存中/完成反馈。<br />
- 不新增独立页面，除非现有信息架构确实无法容纳。<br />
- 不把页面做成项目管理/数据库表格风格的默认体验。<br />
- 如果需要图表，图表必须回答明确问题，并保留原始数据/筛选入口。<br />
<br />
先给出组件层级和交互状态，再编码。</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

# **15. Codex 任务模板（以后每次复制）**

如果不是使用上面的固定里程碑提示词，可以使用这个短模板。它对应 Codex
官方建议的“目标 / 上下文 / 约束 / 完成条件”。

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>【目标】<br />
&lt;要构建/修改什么；只写一个清晰任务&gt;<br />
<br />
【上下文】<br />
- 相关产品文档：&lt;路径&gt;<br />
- 相关模块/文件：&lt;路径&gt;<br />
- 当前问题/现状：&lt;说明&gt;<br />
<br />
【约束】<br />
- 遵守 AGENTS.md。<br />
- 不扩大范围，不引入未授权依赖/云服务/AI API。<br />
- &lt;本任务额外约束&gt;<br />
<br />
【完成条件】<br />
- &lt;可观察行为 1&gt;<br />
- &lt;可观察行为 2&gt;<br />
- 相关单元/集成测试通过。<br />
- pnpm test / pnpm build 通过（以及适用的 Rust/Tauri 检查）。<br />
- 更新 DEVLOG.md。<br />
<br />
先检查代码并给出简短计划，再实现。遇到非架构性小歧义时采用最小、可逆方案并记录，不要停在问题列表里。</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

# **16. ADR：需要 Codex 记录的技术决策**

以下事项一旦做出选择，应在 docs/adr/ 创建短 ADR，避免后续 Codex
会话反复推翻：

- SQLite migration 框架和命名规则。

- ObjectLink 与强外键的使用边界。

- 模板 schema 表达方式与历史快照策略。

- 全文搜索方案（LIKE/FTS5）以及何时启用 FTS。

- Life Landscape 的空间布局是否需要第三方布局库；若无必要优先使用简单、可控的自有布局。

- 备份格式、schemaVersion 升级和恢复策略。

- Tauri 平台插件的权限与 capability 配置。

**ADR 模板**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th># ADR-00X: &lt;标题&gt;<br />
Status: Accepted<br />
Date: YYYY-MM-DD<br />
<br />
## Context<br />
为什么需要决定。<br />
<br />
## Decision<br />
最终选择。<br />
<br />
## Consequences<br />
好处、代价、后续限制。<br />
<br />
## Alternatives considered<br />
至少记录一个被放弃方案及原因。</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

# **17. 发布前验收清单**

| **验收项** | **通过标准**                                                            |
|------------|-------------------------------------------------------------------------|
| 核心闭环   | 愿景/方向 → 目标 → 行动 → 执行反馈 → 周期复盘 → 调整可以完整走通。      |
| 人生状态   | 首页和领域页能帮助用户看清当前状态，但不生成武断总分。                  |
| 低维护     | 典型日常记录不超过 5–10 分钟；漏填一天不阻断系统。                      |
| 决策       | 重大决策能引用导航、领域、目标、人物和资源背景，并记录结果复盘。        |
| 问题发现   | 至少一组规则能发现停滞/反复问题，并显示触发证据。                       |
| AI 导出    | 不同场景模板能按条件生成高质量上下文；无任何直接 AI 调用。              |
| 数据安全   | 备份恢复通过；migration 不丢数据；软删除和版本历史可用。                |
| 本地优先   | 断网情况下核心功能完全可用。                                            |
| 性能       | 普通个人数据量下首页/目标/复盘打开无明显等待；大列表有分页/虚拟化计划。 |
| 边界       | 没有 Knowledge Hub、云同步、生命周期阶段、复杂指数等后续扩展混入 V1。   |

# **18. 后续扩展的技术预留（只预留，不开发）**

| **扩展**      | **V1 预留方式**                           | **V1 禁止事项**               |
|---------------|-------------------------------------------|-------------------------------|
| 健康/手环数据 | Metric source/provider 字段；导入接口边界 | 不做设备 SDK 和医学判断       |
| 自动数据采集  | import adapter 接口、source metadata      | 不做外部账号授权              |
| 生命周期阶段  | Goal/navigation 可增加 stage link         | 不显示空模块                  |
| 高级计划指数  | 保留 PlanChange 完整事实数据              | 不计算“韧性分”等复杂指数      |
| 关系图谱      | ObjectLink 数据足够支持未来图谱           | 不做网络编辑器                |
| 插件系统      | 模块服务和 repository 边界清晰            | 不先做通用插件运行时          |
| 移动端        | domain/repository 不绑定窗口 API          | 不为了同步改成本地+云混合架构 |
| 加密          | 备份/schema 可版本化                      | 不在 V1 临时拼接半成品加密    |

# **19. 推荐的实际开发节奏**

1.  把三份规范文档转换/复制为 Markdown 放进 docs/specs；根目录放
    AGENTS.md。

2.  在 Codex 中先运行“总控提示词”，只做 M0。

3.  M0 完成后建立第一个稳定 tag/commit，再进入 M1。

4.  每个里程碑拆成 2–5 个可独立验收的小任务；每个任务都用第 15 节模板。

5.  每次数据库变化单独检查 migration；每次产品边界变化更新
    spec/ADR，而不是只留在聊天里。

6.  同类错误第二次出现时，更新 AGENTS.md
    或补专门测试；不要不断靠更长提示词纠正。

7.  M3 复盘闭环完成后，开始用真实数据试用，再决定 M4–M7 的优先顺序。

| **建议** 不要把“Codex 很能写代码”理解为“可以一次把整个系统交给它”。对 LifeOS 这类长期本地数据产品，最重要的是每一步都保持 schema、迁移和产品边界可审查。 |
|----------------------------------------------------------------------------------------------------------------------------------------------------------|

# **20. 官方参考**

• [<u>OpenAI Codex Best
Practices</u>](https://developers.openai.com/guides/best-practices)

• [<u>OpenAI - AGENTS.md project
instructions</u>](https://developers.openai.com/docs/agent-configuration/agents-md)

• [<u>OpenAI Codex
CLI</u>](https://developers.openai.com/docs/codex/cli)

• [<u>Tauri 2 - Create a
Project</u>](https://v2.tauri.app/start/create-project/)

• [<u>Tauri 2 - Frontend /
Vite</u>](https://v2.tauri.app/start/frontend/vite/)

• [<u>Tauri 2 - SQL Plugin</u>](https://v2.tauri.app/plugin/sql/)

# **附录 A：产品边界速查**

| **进入 LifeOS V1**                                                                                           | **不进入 LifeOS V1**                |
|--------------------------------------------------------------------------------------------------------------|-------------------------------------|
| 人生导航、领域、目标/行动、复盘、Inbox、问题、决策、日历、习惯、人物、能力、资源聚合、分析、模板、导出、备份 | Knowledge Hub 文件/实体资源目录管理 |
| 规则统计与可解释“值得关注”提示                                                                               | 复杂人生指数、自动因果判断          |
| 场景化 AI 上下文导出                                                                                         | 内置/直连 AI                        |
| 本地 SQLite                                                                                                  | 云数据库、账号、多用户协作          |
| Windows 优先、macOS 架构兼容                                                                                 | V1 手机端和实时同步                 |
| 健康领域状态/目标/习惯                                                                                       | 手环/健康平台详细数据接入           |

# **附录 B：给 Codex 的交付汇报格式**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>完成后请按以下格式汇报：<br />
<br />
1. 完成内容<br />
- ...<br />
<br />
2. 主要修改文件<br />
- path: 说明<br />
<br />
3. 数据库变化<br />
- migration: ...<br />
- 数据兼容性: ...<br />
<br />
4. 验证<br />
- pnpm test: PASS/FAIL<br />
- pnpm build: PASS/FAIL<br />
- cargo check / tauri: PASS/FAIL/未运行及原因<br />
- 手工验收: ...<br />
<br />
5. 已知限制/风险<br />
- ...<br />
<br />
6. 下一步建议<br />
- 只列与当前里程碑直接相关的下一步，不扩展产品范围。</th>
</tr>
</thead>
<tbody>
</tbody>
</table>
