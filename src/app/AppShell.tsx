import {
  CalendarDays,
  CircleAlert,
  Compass,
  Ellipsis,
  ListChecks,
  NotebookPen,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
} from "lucide-react";
import { Suspense, useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useLifeOS } from "./LifeOSContext";
import { defaultModulePreference, isModulePathEnabled } from "../domain/system/ModulePreference";
import { defaultNavigationPreference, pinnableCapabilities } from "../domain/system/NavigationPreference";
import { capabilityIcons, currentNavigationModule, secondaryNavigation } from "./NavigationCatalog";
import { QuickCapture } from "../components/QuickCapture";
import { ThemePicker } from "../components/ThemePicker";

const navigationItems = [
  { to: "/", label: "人生景观", icon: Compass, end: true },
  { to: "/goals", label: "目标与行动", icon: ListChecks },
  { to: "/reviews", label: "复盘", icon: NotebookPen },
  { to: "/calendar", label: "日历", icon: CalendarDays },
  { to: "/attention", label: "关注中心", icon: CircleAlert },
  { to: "/more", label: "更多", icon: Ellipsis },
];

export interface AppShellOutletContext {
  openQuickCapture(): void;
}

export function AppShell() {
  const { modulePreference = defaultModulePreference(),
    navigationPreference = defaultNavigationPreference() } = useLifeOS();
  const [expanded, setExpanded] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const captureTrigger = useRef<HTMLElement | null>(null);
  const { pathname, search } = useLocation();
  const pinned = navigationPreference.pinnedCapabilities.map(key =>
    pinnableCapabilities.find(item => item.key === key)!)
    .filter(item => isModulePathEnabled(item.path, modulePreference));
  const currentModule = currentNavigationModule(pathname);
  const secondaryItems = isModulePathEnabled(pathname, modulePreference) ? secondaryNavigation(pathname, search) : [];
  const moreActive = currentModule && !navigationItems.some(item => item.to === currentModule.path) &&
    !pinned.some(item => item.path === currentModule.path);
  const navigate = useNavigate();
  const openQuickCapture = () => {
    captureTrigger.current = document.activeElement instanceof HTMLElement ?
      document.activeElement : null;
    setCaptureOpen(true);
  };
  const closeQuickCapture = () => {
    setCaptureOpen(false);
    requestAnimationFrame(() => {
      if (captureTrigger.current?.isConnected) captureTrigger.current.focus();
    });
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        navigate("/search");
        requestAnimationFrame(() => document.querySelector<HTMLInputElement>(
          'input[aria-label="搜索本地记录"]')?.focus());
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [navigate]);
  return (
    <div className={`app-shell${expanded ? " sidebar-expanded" : ""}`}>
      <aside className="sidebar" aria-label="主导航">
        <div className="brand-lockup" title="LifeOS">
          <div className="brand-mark">L</div>
          {expanded ? <span className="brand-name">LifeOS</span> : null}
        </div>
        <button type="button" className="icon-button sidebar-toggle"
          title={expanded ? "收起侧栏" : "展开侧栏"} aria-label={expanded ? "收起侧栏" : "展开侧栏"}
          aria-expanded={expanded} aria-controls="sidebar-navigation"
          onClick={() => setExpanded(value => !value)}>
          {expanded ? <PanelLeftClose size={18} aria-hidden="true" /> : <PanelLeftOpen size={18} aria-hidden="true" />}
        </button>
        <div className="sidebar-navigation" id="sidebar-navigation">
        <nav aria-label="主要页面">
          {navigationItems.filter(item => isModulePathEnabled(item.to, modulePreference)).map(({ to, label, icon: Icon, end }) => (
            <NavLink
              className={({ isActive }) =>
                `nav-link${isActive || (to === "/" && pathname.startsWith("/domains/")) ||
                  (to === "/more" && moreActive) ? " active" : ""}`}
              end={end}
              key={to}
              to={to}
              title={label}
              aria-label={label}
            >
              <Icon aria-hidden="true" size={19} strokeWidth={1.8} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        {pinned.length ? <nav className="pinned-navigation" aria-label="常用能力">
          {pinned.map(option => {
            const Icon = capabilityIcons[option.key];
            return <NavLink key={option.key} to={option.path} title={option.label} aria-label={option.label}
              className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
              <Icon size={19} strokeWidth={1.8} aria-hidden="true" /><span>{option.label}</span>
            </NavLink>;
          })}
        </nav> : null}
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <NavLink to="/search" className="topbar-search" title="搜索本地记录"
            aria-label="搜索本地记录">
            <Search size={17} aria-hidden="true" />
            <span>搜索目标、行动、复盘或其他记录</span>
            <kbd>Ctrl K</kbd>
          </NavLink>
          <div className="topbar-actions">
            {isModulePathEnabled("/inbox", modulePreference) ? <button className="icon-button topbar-capture" type="button" title="快速记录"
              aria-label="快速记录" onClick={openQuickCapture}>
              <Plus aria-hidden="true" size={20} />
            </button> : null}
            {isModulePathEnabled("/attention", modulePreference) ? <NavLink to="/attention" className="icon-button topbar-attention"
              aria-label="关注中心" title="关注中心">
              <CircleAlert aria-hidden="true" size={18} strokeWidth={1.8} />
            </NavLink> : null}
            <ThemePicker />
          </div>
        </header>
        {secondaryItems.length ? <nav className="module-secondary-navigation"
          aria-label={currentModule!.label + "二级导航"}>
          {secondaryItems.map(item => <Link key={item.label} to={item.to}
            className={item.active ? "active" : undefined}
            onClick={event => { if (item.active && !event.ctrlKey && !event.metaKey &&
              !event.shiftKey && !event.altKey) event.preventDefault(); }}
            aria-current={item.active ? "page" : undefined}>{item.label}</Link>)}
        </nav> : null}
        <main className="page-content">
          <Suspense fallback={<p className="context-loading" role="status">正在打开页面</p>}>
            <Outlet context={{ openQuickCapture } satisfies AppShellOutletContext} />
          </Suspense>
        </main>
      </div>
      {captureOpen ? <QuickCapture onClose={closeQuickCapture} /> : null}
    </div>
  );
}
