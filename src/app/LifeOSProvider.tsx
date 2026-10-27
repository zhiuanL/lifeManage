import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createApplicationDependencies, type ApplicationDependencies } from "./applicationDependencies";
import { LifeOSContext } from "./LifeOSContext";
import type { ModulePreference } from "../domain/system/ModulePreference";
import type { NavigationPreference, NavigationPreferenceUpdate } from "../domain/system/NavigationPreference";
import type { ThemeKey } from "../domain/life/ThemePreference";
import { DatabaseCompatibilityError } from "../db/DatabaseCompatibilityError";
import { PreferenceReadError } from "../domain/system/PreferenceReadError";

type InitializationState =
  | { kind: "loading" }
  | { kind: "ready"; dependencies: ApplicationDependencies; theme: ThemeKey; modulePreference: ModulePreference; navigationPreference: NavigationPreference }
  | { kind: "error"; message: string };

export function LifeOSProvider({ children }: { children: ReactNode }) {
  const dependencies = useMemo(() => createApplicationDependencies(), []);
  const [state, setState] = useState<InitializationState>({ kind: "loading" });
  const mounted = useRef(false);
  const pendingInitialization = useRef<Promise<InitializationState> | null>(null);
  const lifecycle = useRef(0);

  const loadInitialization = useCallback((): Promise<InitializationState> => {
    if (pendingInitialization.current) return pendingInitialization.current;
    const operation = (async (): Promise<InitializationState> => {
      try {
        await dependencies.bootstrapApplicationService.bootstrap();
        const theme = await dependencies.themePreferenceService.getTheme();
        const modulePreference = await dependencies.modulePreferenceService.get();
        const navigationPreference = await dependencies.navigationPreferenceService.get();
        return { kind: "ready", dependencies, theme, modulePreference, navigationPreference };
      } catch (error) {
        return {
          kind: "error",
          message: error instanceof DatabaseCompatibilityError || error instanceof PreferenceReadError
            ? error.message
            : "本地数据初始化失败，请重试。若持续失败，请先备份本地数据，再检查文件访问权限。",
        };
      }
    })();
    pendingInitialization.current = operation;
    void operation.then(() => {
      if (pendingInitialization.current === operation) pendingInitialization.current = null;
    });
    return operation;
  }, [dependencies]);

  const retryInitialization = useCallback(() => {
    if (!mounted.current || pendingInitialization.current) return;
    const generation = lifecycle.current;
    setState({ kind: "loading" });
    void loadInitialization().then(nextState => {
      if (mounted.current && lifecycle.current === generation) setState(nextState);
    });
  }, [loadInitialization]);

  useEffect(() => {
    let isCurrent = true;
    mounted.current = true;
    lifecycle.current++;

    void loadInitialization().then((nextState) => {
      if (isCurrent) {
        setState(nextState);
      }
    });

    return () => {
      isCurrent = false;
      mounted.current = false;
    };
  }, [loadInitialization]);

  useEffect(() => {
    if (state.kind === "ready") {
      document.documentElement.dataset.theme = state.theme;
    }
  }, [state]);

  const setTheme = useCallback(
    async (theme: ThemeKey) => {
      await dependencies.themePreferenceService.setTheme(theme);
      if (mounted.current) setState((currentState) =>
        currentState.kind === "ready" ? { ...currentState, theme } : currentState,
      );
    },
    [dependencies],
  );

  const setModulePreference = useCallback(async (preference: ModulePreference) => {
    await dependencies.modulePreferenceService.save(preference);
    if (mounted.current) setState(current => current.kind === "ready" ? { ...current, modulePreference: preference } : current);
  }, [dependencies]);

  const updateNavigationPreference = useCallback(async (change: NavigationPreferenceUpdate) => {
    const navigationPreference = await dependencies.navigationPreferenceService.update(change);
    if (mounted.current) setState(current => current.kind === "ready"
      ? { ...current, navigationPreference } : current);
  }, [dependencies]);

  if (state.kind === "loading") {
    return (
      <main className="application-loading" aria-live="polite">
        <span className="loading-mark" aria-hidden="true">
          L
        </span>
        <p>正在准备你的生活空间</p>
      </main>
    );
  }

  if (state.kind === "error") {
    return (
      <main className="initialization-error" aria-live="assertive">
        <p className="eyebrow">LifeOS</p>
        <h1>无法打开本地生活空间</h1>
        <p>{state.message}</p>
        <button type="button" className="button-primary" onClick={retryInitialization}>
          重试
        </button>
      </main>
    );
  }

  return (
    <LifeOSContext.Provider
      value={{
        environment: state.dependencies.environment,
        lifeDomainService: state.dependencies.lifeDomainService,
        landscapeFactService: state.dependencies.landscapeFactService,
        landscapeContextService: state.dependencies.landscapeContextService,
        lifeNavigationService: state.dependencies.lifeNavigationService,
        identityRoleService: state.dependencies.identityRoleService,
        domainMetricService: state.dependencies.domainMetricService,
        habitService: state.dependencies.habitService,
        lifeRecordsService: state.dependencies.lifeRecordsService,
        resourceService: state.dependencies.resourceService,
        systemAssessmentService: state.dependencies.systemAssessmentService,
        dataQualityService: state.dependencies.dataQualityService,
        goalService: state.dependencies.goalService,
        goalProgressItemService: state.dependencies.goalProgressItemService,
        actionService: state.dependencies.actionService,
        reviewService: state.dependencies.reviewService,
        reviewFactService: state.dependencies.reviewFactService,
        inboxService: state.dependencies.inboxService,
        issueService: state.dependencies.issueService,
        decisionService: state.dependencies.decisionService,
        attentionService: state.dependencies.attentionService,
        analyticsService: state.dependencies.analyticsService,
        contextExportService: state.dependencies.contextExportService,
        searchService: state.dependencies.searchService,
        versionHistoryService: state.dependencies.versionHistoryService,
        goalTimelineService: state.dependencies.goalTimelineService,
        domainTimelineService: state.dependencies.domainTimelineService,
        personRelationshipTimelineService: state.dependencies.personRelationshipTimelineService,
        templateService: state.dependencies.templateService,
        backupService: state.dependencies.backupService,
        landscapePreferenceService: state.dependencies.landscapePreferenceService,
        setupProgressService: state.dependencies.setupProgressService,
        modulePreference: state.modulePreference,
        setModulePreference,
        navigationPreference: state.navigationPreference,
        updateNavigationPreference,
        theme: state.theme,
        setTheme,
      }}
    >
      {children}
    </LifeOSContext.Provider>
  );
}
