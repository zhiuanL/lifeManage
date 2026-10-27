import { Plus } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useLifeOS } from "../app/LifeOSContext";
import { SetupInvitation } from "../components/SetupInvitation";
import { DomainEditorDialog } from "../components/DomainEditorDialog";
import { RecommendedDomainsDialog } from "../components/RecommendedDomainsDialog";
import { DomainIcon } from "../components/DomainIcon";
import { LandscapeFactsSection } from "../components/LandscapeFactsSection";
import { LandscapeContextSection } from "../components/LandscapeContextSection";
import { defaultLandscapePreference, orderLandscapeDomains, placeLandscapeDomains, type LandscapePreference } from "../domain/life/LandscapePreference";
import type { LifeDomain } from "../domain/life/LifeDomain";
import { recommendedLifeDomains } from "../domain/life/recommendedLifeDomains";

import { defaultModulePreference, isModulePathEnabled } from "../domain/system/ModulePreference";

type DomainLoader = () => Promise<{ domains: readonly LifeDomain[]; preference: LandscapePreference }>;
type PageState = { source: DomainLoader; generation: number } & (
  { kind: "ready"; domains: readonly LifeDomain[]; preference: LandscapePreference }
  | { kind: "error"; message: string });

export function LandscapePage() {
  const { lifeDomainService, landscapePreferenceService, modulePreference } = useLifeOS();
  const [result, setResult] = useState<PageState | null>(null);
  const [generation, setGeneration] = useState(0);
  const [editor, setEditor] = useState<{ source: DomainLoader } | null>(null);
  const [recommendations, setRecommendations] = useState<{ source: DomainLoader; available: readonly string[] } | null>(null);

  const loadDomains = useCallback(
    async () => {
      const [domains, preference] = await Promise.all([lifeDomainService.list(), landscapePreferenceService.get()]);
      return { domains, preference };
    },
    [lifeDomainService, landscapePreferenceService],
  );
  const currentSource = useRef<DomainLoader>(loadDomains);
  const mounted = useRef(false);
  useLayoutEffect(() => { currentSource.current = loadDomains; }, [loadDomains]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let isCurrent = true;

    void loadDomains()
      .then((data) => {
        if (isCurrent) {
          setResult({ source: loadDomains, generation, kind: "ready", ...data });
        }
      })
      .catch(() => {
        if (isCurrent) {
          setResult({
            source: loadDomains, generation,
            kind: "error",
            message: "无法读取生活景观，请重试。",
          });
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [loadDomains, generation]);

  const reloadDomains = () => {
    setGeneration(value => value + 1);
  };
  const state = result?.source === loadDomains && result.generation === generation
    ? result : { kind: "loading" as const };
  const activeDomains = state.kind === "ready"
    ? orderLandscapeDomains(state.domains.filter((domain) => domain.status === "active"), state.preference) : [];
  const preference = state.kind === "ready" ? state.preference : defaultLandscapePreference();
  const showReviews = preference.showReviews &&
    isModulePathEnabled("/reviews", modulePreference ?? defaultModulePreference());
  const visibleDomains = activeDomains.filter(domain => !preference.hiddenDomainIds.includes(domain.id));
  const hiddenDomains = activeDomains.filter(domain => preference.hiddenDomainIds.includes(domain.id));
  const placement = placeLandscapeDomains(activeDomains, preference);
  const inactiveDomains = state.kind === "ready"
    ? state.domains.filter((domain) => domain.status !== "active") : [];
  const availableRecommendations = state.kind === "ready"
    ? recommendedLifeDomains.map((domain) => domain.name)
      .filter((name) => !state.domains.some((domain) => domain.name.trim() === name))
    : [];

  const landscape = (
    <>
      <section className={`landscape-map${state.kind === "ready" && !activeDomains.length ? " is-empty" : ""}`}
        aria-label="生活领域">
        {state.kind === "error" ? (
          <div className="inline-error">
            <p>{state.message}</p>
            <button className="button-secondary" type="button" onClick={reloadDomains}>
              重试
            </button>
          </div>
        ) : null}
        {state.kind === "loading" ? <LandscapeLoading /> : null}
        {state.kind === "ready" ? (
          <>
            <div className="landscape-stage">
              <div>
                <p className="eyebrow">此刻的生活</p>
                <h2>{activeDomains.length ? "我的生活" : "从这里开始"}</h2>
                <p>{activeDomains.length
                  ? `${activeDomains.length} 个生活领域`
                  : state.domains.length ? "目前没有启用的领域" : "尚未添加生活领域"}</p>
              </div>
            </div>
            {visibleDomains.length > 0 ? (
              <ol className="landscape-nodes">
                {placement.nodes.map(({ domain, slot }) => (
                  <li className={`domain-color-${domain.color}`} key={domain.id} data-slot={slot + 1}>
                    <DomainNode domain={domain} />
                  </li>
                ))}
              </ol>
            ) : null}
          </>
        ) : null}
      </section>

      {state.kind === "ready" ? (
        <div className="landscape-tools">
          {availableRecommendations.length ? (
            <button className="landscape-recommend" type="button"
              onClick={() => setRecommendations({ source: loadDomains, available: availableRecommendations })}>
              添加推荐领域
            </button>
          ) : null}
          <button className="landscape-add" type="button" onClick={() => setEditor({ source: loadDomains })}>
            <Plus aria-hidden="true" size={15} />
            添加领域
          </button>
        </div>
      ) : null}

      {placement.overflow.length > 0 ? (
        <section className="landscape-more" aria-label="更多生活领域">
          <h2>更多生活领域</h2>
          <ol>
            {placement.overflow.map((domain) => (
              <li className={`domain-color-${domain.color}`} key={domain.id}>
                <DomainNode domain={domain} />
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {hiddenDomains.length > 0 ? (
        <details className="landscape-more"><summary>未在景观显示的领域（{hiddenDomains.length}）</summary>
          <ol>{hiddenDomains.map(domain => <li className={`domain-color-${domain.color}`} key={domain.id}><DomainNode domain={domain} /></li>)}</ol>
        </details>
      ) : null}

      {inactiveDomains.length > 0 ? (
        <section className="landscape-more" aria-label="已暂停或归档的领域">
          <h2>已暂停或归档</h2>
          <ol>{inactiveDomains.map((domain) => (
            <li className={`domain-color-${domain.color}`} key={domain.id}>
              <DomainNode domain={domain} />
              <span className="landscape-domain-status">
                {domain.status === "paused" ? "已暂停" : "已归档"}
              </span>
            </li>
          ))}</ol>
        </section>
      ) : null}

    </>
  );

  return (
    <div className="landscape-page">
      <header className="landscape-heading">
        <h1>人生景观</h1>
      </header>

      <SetupInvitation />
      <LandscapeContextSection />
      {state.kind === "ready" ? (
        <LandscapeFactsSection domains={visibleDomains} preference={{ ...preference, showReviews }}>
          {landscape}
        </LandscapeFactsSection>
      ) : landscape}

      {editor ? (
        <DomainEditorDialog
          onClose={() => setEditor(null)}
          onSaved={() => {
            if (!mounted.current) return;
            setEditor(null);
            if (currentSource.current === editor.source) reloadDomains();
          }}
        />
      ) : null}
      {recommendations ? (
        <RecommendedDomainsDialog
          available={recommendations.available}
          onClose={() => setRecommendations(null)}
          onSaved={() => {
            if (!mounted.current) return;
            setRecommendations(null);
            if (currentSource.current === recommendations.source) reloadDomains();
          }}
        />
      ) : null}
    </div>
  );
}

function DomainNode({ domain }: { domain: LifeDomain }) {
  return (
    <Link className="landscape-node" to={`/domains/${encodeURIComponent(domain.id)}`}
      title={domain.name} aria-label={`进入${domain.name}领域`}>
      <span className="landscape-node-icon"><DomainIcon icon={domain.icon} size={18} /></span>
      <span className="landscape-node-text">
        <strong>{domain.name}</strong>
        {domain.currentState || domain.focus ? <small title={domain.currentState || domain.focus}>
          {domain.currentState || domain.focus}
        </small> : null}
      </span>
    </Link>
  );
}

function LandscapeLoading() {
  return (
    <div className="landscape-loading" role="status" aria-label="正在读取生活领域">
      <span className="loading-line" />
      <span className="loading-line short" />
      <span className="loading-line" />
    </div>
  );
}
