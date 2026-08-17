import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { StoreProvider, useStore } from "@/state/store";
import { Onboarding } from "@/components/Onboarding";
import { emailGateDone, initAnalytics } from "@/lib/analytics";
import { Sidebar } from "@/components/Sidebar";
import { ChatView } from "@/components/ChatView";
import { GroupView } from "@/components/GroupView";
import { SettingsPanel } from "@/components/SettingsPanel";
import { PluginsPanel } from "@/components/PluginsPanel";
import { ComputerPanel } from "@/components/ComputerPanel";
import { CloudDesktopView } from "@/components/CloudDesktopView";
import { AppSettingsPanel } from "@/components/AppSettingsPanel";
import { UpdateBanner } from "@/components/UpdateBanner";
import { NoEngines } from "@/components/NoEngines";
import { PaneResizeHandle } from "@/components/PaneResizeHandle";
import {
  CENTER_PANE_MIN_WIDTH,
  LEFT_PANE_DEFAULT_WIDTH,
  LEFT_PANE_MAX_WIDTH,
  LEFT_PANE_MIN_WIDTH,
  PANE_DIVIDER_WIDTH,
  PANE_LAYOUT_STORAGE_KEY,
  RIGHT_PANE_DEFAULT_WIDTH,
  RIGHT_PANE_MAX_WIDTH,
  RIGHT_PANE_MIN_WIDTH,
  clampLeftPaneWidth,
  clampRightPaneWidth,
  isCompactLeftPane,
  normalizePaneWidths,
  type PaneWidths,
} from "@/lib/pane-layout";

function savedPaneWidths(): Partial<PaneWidths> {
  try {
    const value = JSON.parse(localStorage.getItem(PANE_LAYOUT_STORAGE_KEY) ?? "null");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function Shell() {
  const { state, dispatch } = useStore();
  const group = state.groups.find((g) => g.id === state.selectedId);
  const bot = group ? undefined : (state.bots.find((b) => b.id === state.selectedId) ?? state.bots[0]);
  const cloudDesktopBot = state.cloudDesktopBotId
    ? state.bots.find((candidate) => candidate.id === state.cloudDesktopBotId)
    : undefined;
  const noEngines = state.connected && state.instances.length > 0 && !state.instances.some((i) => i.snapshot.state === "available");
  const layoutRef = useRef<HTMLDivElement>(null);
  const rightOpen = Boolean(
    state.settingsOpen || state.computerOpen || state.appSettingsOpen,
  );
  const [layoutWidth, setLayoutWidth] = useState(() => window.innerWidth);
  const [paneWidths, setPaneWidths] = useState<PaneWidths>(() =>
    normalizePaneWidths(savedPaneWidths(), window.innerWidth, rightOpen),
  );

  useEffect(() => {
    localStorage.setItem(PANE_LAYOUT_STORAGE_KEY, JSON.stringify(paneWidths));
  }, [paneWidths]);

  useEffect(() => {
    const element = layoutRef.current;
    if (!element) return;
    const resize = () => {
      const width = element.getBoundingClientRect().width;
      if (!width) return;
      setLayoutWidth(width);
      setPaneWidths((current) => {
        const next = normalizePaneWidths(current, width, rightOpen);
        return next.left === current.left && next.right === current.right ? current : next;
      });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    return () => observer.disconnect();
  }, [rightOpen]);

  const resizeLeft = useCallback((delta: number) => {
    setPaneWidths((current) => ({
      ...current,
      left: clampLeftPaneWidth(current.left + delta, current.right, layoutWidth, rightOpen),
    }));
  }, [layoutWidth, rightOpen]);

  const resizeRight = useCallback((delta: number) => {
    setPaneWidths((current) => ({
      ...current,
      right: clampRightPaneWidth(current.right + delta, current.left, layoutWidth),
    }));
  }, [layoutWidth]);

  const leftMax = Math.min(
    LEFT_PANE_MAX_WIDTH,
    layoutWidth - CENTER_PANE_MIN_WIDTH - (rightOpen ? paneWidths.right : 0) - PANE_DIVIDER_WIDTH * (rightOpen ? 2 : 1),
  );
  const rightMax = Math.min(
    RIGHT_PANE_MAX_WIDTH,
    layoutWidth - CENTER_PANE_MIN_WIDTH - paneWidths.left - PANE_DIVIDER_WIDTH * 2,
  );
  const centerWidth = layoutWidth
    - paneWidths.left
    - PANE_DIVIDER_WIDTH
    - (rightOpen ? paneWidths.right + PANE_DIVIDER_WIDTH : 0);
  const compactCenterHeader = centerWidth < 520;
  const compactSidebar = isCompactLeftPane(paneWidths.left);

  // App-wide shortcuts: ⌘N new bot · ⌘1–9 jump to bot · ⌘⇧[ / ⌘⇧] prev/next.
  // Kept deliberately small; every panel already closes on Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const bots = state.bots.filter((b) => !b.hidden);
      if (e.key === "n" && !e.shiftKey) {
        e.preventDefault();
        dispatch({ type: "newBot" });
      } else if (/^[1-9]$/.test(e.key)) {
        const target = bots[Number(e.key) - 1];
        if (target) {
          e.preventDefault();
          dispatch({ type: "select", id: target.id });
        }
      } else if (e.shiftKey && (e.key === "[" || e.key === "]")) {
        const idx = bots.findIndex((b) => b.id === state.selectedId);
        const next = bots[(idx + (e.key === "]" ? 1 : -1) + bots.length) % bots.length];
        if (next) {
          e.preventDefault();
          dispatch({ type: "select", id: next.id });
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.bots, state.selectedId, dispatch]);

  return (
    <div className="flex h-full flex-col bg-app">
      {/* fixed-position popup, bottom-left — outside the layout flow */}
      <UpdateBanner />
      <div ref={layoutRef} className="relative flex min-h-0 flex-1 overflow-hidden">
        <div className="h-full min-w-0 shrink-0" style={{ width: paneWidths.left }}>
          <Sidebar compact={compactSidebar} />
        </div>
        <PaneResizeHandle
          label="调整左侧机器人列表宽度"
          value={paneWidths.left}
          min={LEFT_PANE_MIN_WIDTH}
          max={leftMax}
          onResize={resizeLeft}
          onReset={() => resizeLeft(LEFT_PANE_DEFAULT_WIDTH - paneWidths.left)}
        />

        <div className="h-full min-w-0 flex-1">
          {noEngines ? (
            <NoEngines />
          ) : group ? (
            <GroupView
              key={group.id}
              group={group}
              reserveWindowControls={!rightOpen}
              compactHeader={compactCenterHeader}
            />
          ) : bot ? (
            <ChatView
              bot={bot}
              reserveWindowControls={!rightOpen}
              compactHeader={compactCenterHeader}
            />
          ) : (
            <main className="flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-3 bg-app text-ink-secondary">
              <Loader2 size={20} className="animate-spin" />
              <div className="text-[14px]">
                {state.connected ? "暂无机器人" : "正在连接机器人服务器…"}
              </div>
              {!state.connected && (
                <div className="text-[12px]">
                  请运行 <code className="rounded bg-raised px-1.5 py-0.5">pnpm dev:server</code> 启动服务器
                </div>
              )}
            </main>
          )}
        </div>

        {rightOpen && (
          <>
            <PaneResizeHandle
              label="调整右侧面板宽度"
              value={paneWidths.right}
              min={RIGHT_PANE_MIN_WIDTH}
              max={rightMax}
              direction={-1}
              onResize={resizeRight}
              onReset={() => resizeRight(RIGHT_PANE_DEFAULT_WIDTH - paneWidths.right)}
            />
            <div className="h-full min-w-0 shrink-0" style={{ width: paneWidths.right }}>
              {state.settingsOpen && bot ? (
                <SettingsPanel bot={bot} />
              ) : state.computerOpen && bot ? (
                <ComputerPanel bot={bot} />
              ) : state.appSettingsOpen ? (
                <AppSettingsPanel />
              ) : null}
            </div>
          </>
        )}
        {state.pluginsOpen && <PluginsPanel />}
      </div>
      {cloudDesktopBot && <CloudDesktopView key={cloudDesktopBot.id} bot={cloudDesktopBot} />}
    </div>
  );
}

export default function App() {
  const [gated, setGated] = useState(() => !emailGateDone());
  useEffect(() => {
    initAnalytics();
  }, []);
  return (
    <StoreProvider>
      <Shell />
      {gated && <Onboarding onDone={() => setGated(false)} />}
    </StoreProvider>
  );
}
