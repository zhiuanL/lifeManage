# LifeOS V1 — 信息架构与对象关系

## 核心关系

Life Landscape
→ Life Domain
→ Contextual Capabilities
→ Concrete Objects

不是：

Domain A
  └ Module A Copy
Domain B
  └ Module B Copy

而是：

一个全局 Goal 模块
+ Domain Context Filter

一个全局 Problem 模块
+ Domain Context Filter

一个全局 Review 模块
+ Domain Context Filter

因此 LifeOS 是关系网络，不是树状项目目录。

## 领域（Domain）

领域是一种长期生活语境。

例：
- 事业
- 健康
- 成长
- 关系
- 财务
- 创造力
- 家庭
- 精神生活
- 用户自定义

字段建议：
- id
- name
- description
- long_term_expectation
- status
- satisfaction
- identity_color
- icon
- sort_order
- landscape_position
- enabled
- lifecycle_status
- created_at
- archived_at

lifecycle_status:
- active
- paused
- archived

## 多对多关联

下列对象与 Domain 使用 many-to-many：

- Goal
- Action
- Habit
- Review
- Problem
- Decision
- Person
- Event
- Ability
- Resource Reference

建议统一关系表：

domain_links
- id
- domain_id
- object_type
- object_id
- relation_type
- created_at

relation_type 可扩展：
- primary
- related
- affected
- supports

## 导航

入口 A：
Life Landscape → Domain → Capability → Object

入口 B：
Sidebar / More → Capability → Object

入口 C：
Search / Command → Object

入口 D：
Inbox → Convert → Object

它们必须落到同一数据模型，不允许形成不同副本。

## 系统级能力

不要求 Domain 关联：
- Settings
- Backup / Restore
- Theme
- Import / Export
- Database Maintenance
- Global System Health

## Inbox

Inbox 为全局捕捉层。

初始状态可以无领域。

处理时：
- 选择 0..N 个领域
- 转为具体对象
- 或归档

## Analytics

支持：
- 全局分析
- 单领域分析
- 多领域对比
- 时间区间
- 目标关联分析

默认只展示事实、趋势与相关性，不进行因果断言。
