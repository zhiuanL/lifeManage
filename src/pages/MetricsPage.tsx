import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import { DomainMetricsSection } from "../components/DomainMetricsSection";
import { useLifeOS } from "../app/LifeOSContext";
import { defaultModulePreference, isModulePathEnabled } from "../domain/system/ModulePreference";

export function MetricsPage() {
  const { modulePreference = defaultModulePreference() } = useLifeOS();
  return <>
    <section className="planning-heading">
      <h1>每日状态与指标</h1>
      {isModulePathEnabled("/analytics", modulePreference) ? <Link className="button-secondary" to="/analytics">
        查看趋势<ArrowUpRight size={16} aria-hidden="true" />
      </Link> : null}
    </section>
    <DomainMetricsSection />
  </>;
}
