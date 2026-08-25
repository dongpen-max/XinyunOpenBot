// Connected apps marketplace, backed by Composio Connect. Catalog comes
// from /api/connectors/catalog — the full toolkit list with logos when a
// Composio API key is configured, a curated set otherwise. Icons resolve
// logo → favicon → monogram.
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, Search, X } from "lucide-react";
import { api, useStore } from "@/state/store";
import { cn } from "@/lib/cn";
import { zhCN } from "@/locales/zh-CN";
import { serviceBrand } from "@/lib/service-brand";

interface ToolkitCard {
  slug: string;
  label: string;
  blurb: string;
  logo: string | null;
  domain: string | null;
}

function ServiceIcon({ card }: { card: ToolkitCard }) {
  const sources = [card.logo, card.domain ? `https://www.google.com/s2/favicons?domain=${card.domain}&sz=64` : null]
    .filter((source): source is string => Boolean(source));
  const [sourceIndex, setSourceIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const brand = serviceBrand(card.slug, card.label);
  const source = sources[sourceIndex];

  useEffect(() => {
    setSourceIndex(0);
    setLoaded(false);
  }, [card.logo, card.domain]);

  return (
    <div
      className="relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-hairline/35 text-[14px] font-bold tracking-tight"
      style={{ background: brand.background, color: brand.foreground }}
      aria-hidden="true"
    >
      <span>{brand.monogram}</span>
      {source && (
        <img
          key={source}
          src={source}
          alt=""
          referrerPolicy="no-referrer"
          className={cn(
            "absolute inset-0 size-full bg-white object-contain p-1 transition-opacity",
            loaded ? "opacity-100" : "opacity-0",
          )}
          onLoad={() => setLoaded(true)}
          onError={() => {
            setLoaded(false);
            setSourceIndex((current) => current + 1);
          }}
        />
      )}
    </div>
  );
}

type ConnectorStatus = Record<string, { connected: boolean }>;

export function PluginsPanel() {
  const { dispatch } = useStore();
  const [cards, setCards] = useState<ToolkitCard[] | null>(null);
  const [source, setSource] = useState<"api" | "public" | "snapshot" | "curated">("curated");
  const [catalogDiagnostic, setCatalogDiagnostic] = useState<string | null>(null);
  const [configured, setConfigured] = useState(true);
  const [status, setStatus] = useState<ConnectorStatus>({});
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const pollTimers = useRef(new Set<number>());

  const refreshStatus = useCallback((slugs: string[]): Promise<ConnectorStatus> => {
    if (!slugs.length) return Promise.resolve({});
    setRefreshing(true);
    return api(`/api/connectors?services=${slugs.join(",")}`)
      .then((r) => {
        const services = r.services ?? {};
        setStatus(services);
        return services as ConnectorStatus;
      })
      .catch(() => ({} as ConnectorStatus))
      .finally(() => setRefreshing(false));
  }, []);

  useEffect(() => {
    let alive = true;
    api("/api/connectors/catalog")
      .then((r) => {
        if (!alive) return;
        setCards(r.cards ?? []);
        setSource(r.source ?? "curated");
        setCatalogDiagnostic(r.diagnostic ?? null);
        setConfigured(Boolean(r.configured));
        if (r.configured) void refreshStatus((r.cards ?? []).map((c: ToolkitCard) => c.slug).slice(0, 40));
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
      for (const timer of pollTimers.current) window.clearInterval(timer);
      pollTimers.current.clear();
    };
  }, [refreshStatus]);

  const connect = (slug: string) => {
    setBusySlug(slug);
    setError(null);
    api(`/api/connectors/${slug}/authorize`, { method: "POST" })
      .then(({ url }) => {
        window.open(url);
        // the user finishes OAuth in the browser; poll a few times to catch it
        let tries = 0;
        const timer = window.setInterval(() => {
          void refreshStatus([slug]).then((services) => {
            if (++tries >= 6 || services[slug]?.connected) {
              window.clearInterval(timer);
              pollTimers.current.delete(timer);
            }
          });
        }, 5000);
        pollTimers.current.add(timer);
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusySlug(null));
  };

  const disconnect = (slug: string) => {
    setBusySlug(slug);
    api(`/api/connectors/${slug}`, { method: "DELETE" })
      .then(() => {
        void refreshStatus([slug]);
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusySlug(null));
  };

  const visible = (cards ?? []).filter(
    (c) => !search || `${c.label} ${c.slug} ${c.blurb}`.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px] sm:p-6"
      onMouseDown={(event) => event.target === event.currentTarget && dispatch({ type: "togglePlugins", open: false })}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="connected-apps-title"
        className="animate-pop-in flex h-[min(780px,calc(100dvh-2rem))] w-full max-w-[1040px] flex-col overflow-hidden rounded-[24px] border border-hairline/50 bg-panel shadow-2xl shadow-black/50"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 px-6 pb-3 pt-6 sm:px-8 sm:pt-7">
          <div>
            <h2 id="connected-apps-title" className="text-[22px] font-semibold tracking-[-0.01em] text-ink">
              {zhCN.plugins.title}
            </h2>
            <p className="mt-1 text-[13px] text-ink-secondary">{zhCN.plugins.desc}</p>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => refreshStatus(visible.map((c) => c.slug).slice(0, 40))}
              className="rounded-lg p-2 text-ink-secondary hover:bg-raised hover:text-ink"
              title={zhCN.plugins.refreshStatus}
            >
              <RefreshCw size={17} className={cn(refreshing && "animate-spin")} />
            </button>
            <button
              onClick={() => dispatch({ type: "togglePlugins", open: false })}
              aria-label="关闭已连接的应用"
              className="rounded-lg p-2 text-ink-secondary hover:bg-raised hover:text-ink"
            >
              <X size={21} />
            </button>
          </div>
        </header>

        <div className="flex flex-col gap-3 px-6 pb-4 pt-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div className="text-[12px] font-medium text-ink-secondary">
            {search ? "搜索结果" : "可用应用"}
            {cards && <span className="ml-2 font-normal text-ink-secondary/70">共 {visible.length} 个</span>}
          </div>
          <label className="flex h-11 w-full items-center gap-2.5 rounded-xl bg-raised/70 px-3.5 sm:w-[320px]">
            <Search size={17} className="shrink-0 text-ink-secondary" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={zhCN.plugins.searchApps}
              aria-label={zhCN.plugins.searchApps}
              className="min-w-0 flex-1 bg-transparent text-[14px] text-ink placeholder:text-ink-secondary focus:outline-none"
            />
          </label>
        </div>

        {!configured && (
          <div className="mx-6 mb-1 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-[13px] text-warning sm:mx-8">
            {zhCN.plugins.noComposioKey}
            <button
              className="underline"
              onClick={() => {
                dispatch({ type: "togglePlugins", open: false });
                dispatch({ type: "toggleAppSettings", open: true });
              }}
            >
              {zhCN.plugins.addInSettings}
            </button>
            {zhCN.plugins.toConnectApps}
          </div>
        )}
        {configured && source === "curated" && (
          <div className="mx-6 mb-1 text-[12px] text-ink-secondary sm:mx-8">
            {zhCN.plugins.showingCurated}{" "}
            <button
              className="underline hover:text-ink"
              onClick={() => {
                dispatch({ type: "togglePlugins", open: false });
                dispatch({ type: "toggleAppSettings", open: true });
              }}
            >
              {zhCN.plugins.addComposioApi}
            </button>
            {zhCN.plugins.toBrowseFull}
          </div>
        )}
        {source === "public" && (
          <div className="mx-6 mb-1 text-[12px] text-ink-secondary sm:mx-8">
            {zhCN.plugins.showingPublic}
            {catalogDiagnostic && <span className="ml-1 text-ink-secondary/75">{zhCN.plugins.catalogApiError}</span>}
          </div>
        )}
        {source === "snapshot" && (
          <div className="mx-6 mb-1 text-[12px] text-ink-secondary sm:mx-8">
            {zhCN.plugins.showingSnapshot}
            {catalogDiagnostic && <span className="ml-1 text-ink-secondary/75">{zhCN.plugins.catalogApiError}</span>}
          </div>
        )}
        {error && <div role="alert" className="mx-6 mt-2 rounded-lg bg-danger/10 px-3 py-2 text-[12px] text-danger sm:mx-8">{error}</div>}

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-7 pt-5 sm:px-8">
          {cards === null ? (
            <div className="flex items-center justify-center gap-2 py-24 text-[13px] text-ink-secondary">
              <Loader2 size={14} className="animate-spin" /> {zhCN.plugins.loadingCatalog}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-x-10 md:grid-cols-2">
              {visible.map((card) => {
                const connected = status[card.slug]?.connected;
                const busy = busySlug === card.slug;
                return (
                  <div key={card.slug} className="min-h-[88px] border-b border-hairline/35 px-1 py-4">
                    <div className="flex items-center gap-3">
                      <ServiceIcon card={card} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 truncate text-[14px] font-medium text-ink">
                          {card.label}
                          {connected && <span className="size-1.5 shrink-0 rounded-full bg-success" />}
                        </div>
                        <div className="mt-0.5 truncate text-[12.5px] text-ink-secondary">{card.blurb}</div>
                      </div>
                      <button
                        disabled={!configured || busy}
                        onClick={() => (connected ? disconnect(card.slug) : connect(card.slug))}
                        className={cn(
                          "flex min-w-[88px] items-center justify-center rounded-full bg-raised px-3 py-2 text-[12.5px] text-ink transition-colors hover:bg-raised-hover disabled:opacity-40",
                          connected && "text-ink-secondary hover:text-danger",
                        )}
                      >
                        {busy ? <Loader2 size={13} className="animate-spin" /> : connected ? zhCN.plugins.disconnect : zhCN.plugins.connect}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {cards !== null && visible.length === 0 && (
            <div className="py-8 text-center text-[13px] text-ink-secondary">{zhCN.plugins.noAppsMatch}</div>
          )}
        </div>
      </div>
    </div>
  );
}
