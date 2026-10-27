export function validateDomainSatisfactionBackupData(data: Record<string, unknown>): void {
  if (!Array.isArray(data.domain_satisfaction_links) || !Array.isArray(data.metric_domain_links) ||
    !Array.isArray(data.metric_definitions) || !Array.isArray(data.life_domains)) {
    throw new Error("备份缺少领域满意度数据表。");
  }
  const domains = new Set(data.life_domains.map(row => (row as Record<string, unknown>).id));
  const metrics = new Set(data.metric_definitions.map(row => (row as Record<string, unknown>).id));
  const pairs = new Set(data.metric_domain_links.map(value => {
    const row = value as Record<string, unknown>;
    return JSON.stringify([row.domain_id, row.metric_id]);
  }));
  const seen = new Set<string>();
  for (const value of data.domain_satisfaction_links) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("领域满意度备份记录无效。");
    }
    const row = value as Record<string, unknown>;
    if (Object.keys(row).length !== 2 || typeof row.domain_id !== "string" ||
      typeof row.metric_id !== "string" || !domains.has(row.domain_id) || !metrics.has(row.metric_id) ||
      !pairs.has(JSON.stringify([row.domain_id, row.metric_id])) || seen.has(row.domain_id)) {
      throw new Error("领域满意度评分引用无效或重复。");
    }
    seen.add(row.domain_id);
  }
}
