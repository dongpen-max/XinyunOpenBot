// Connected apps marketplace, backed by Composio Connect. Catalog comes
// from /api/connectors/catalog — the full toolkit list with logos when a
// Composio API key is configured, a curated set otherwise. Icons resolve
// logo → favicon → monogram.
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, X } from "lucide-react";
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
      className="relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-hairline/35 text-[11px] font-bold tracking-tight"
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
            "absolute inset-0 size-full bg-white object-contain p-0.5 transition-opacity",
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
  const [source, setSource] = useState<"api" | "curated">("curated");
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
      className="absolute inset-0 z-20 flex items-center justify-center bg-black/40"
      onClick={() => dispatch({ type: "togglePlugins", open: false })}
    >
      <div
        className="animate-pop-in flex max-h-[80%] w-[560px] flex-col rounded-2xl border border-hairline/50 bg-panel p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="text-[17px] font-semibold text-ink">{zhCN.plugins.title}</div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => refreshStatus(visible.map((c) => c.slug).slice(0, 40))}
              className="rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink"
              title={zhCN.plugins.refreshStatus}
            >
              <RefreshCw size={15} className={cn(refreshing && "animate-spin")} />
            </button>
            <button
              onClick={() => dispatch({ type: "togglePlugins", open: false })}
              className="rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink"
            >
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="mt-1 text-[13px] text-ink-secondary">
          {zhCN.plugins.desc}
        </div>

        {!configured && (
          <div className="mt-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[13px] text-warning">
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
          <div className="mt-3 text-[12px] text-ink-secondary">
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
        {error && <div className="mt-2 text-[12px] text-danger">{error}</div>}

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={zhCN.plugins.searchApps}
          className="mt-3 w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none"
        />

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-xl border border-hairline/40">
          {cards === null ? (
            <div className="flex items-center justify-center gap-2 py-8 text-[13px] text-ink-secondary">
              <Loader2 size={14} className="animate-spin" /> {zhCN.plugins.loadingCatalog}
            </div>
          ) : (
            visible.map((card, i) => {
              const connected = status[card.slug]?.connected;
              const busy = busySlug === card.slug;
              return (
                <div
                  key={card.slug}
                  className={cn(
                    "flex items-center gap-3 bg-card px-4 py-3",
                    i > 0 && "border-t border-hairline/40",
                  )}
                >
                  <ServiceIcon card={card} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[14px] font-medium text-ink">
                      {card.label}
                      {connected && <span className="size-1.5 rounded-full bg-success" />}
                    </div>
                    <div className="truncate text-[12px] text-ink-secondary">{card.blurb}</div>
                  </div>
                  <button
                    disabled={!configured || busy}
                    onClick={() => (connected ? disconnect(card.slug) : connect(card.slug))}
                    className={cn(
                      "w-[92px] rounded-lg py-1.5 text-[13px] disabled:opacity-50",
                      connected
                        ? "bg-raised text-ink-secondary hover:text-danger"
                        : "bg-raised text-ink hover:bg-raised-hover",
                    )}
                  >
                    {busy ? (
                      <Loader2 size={13} className="mx-auto animate-spin" />
                    ) : connected ? (
                      zhCN.plugins.disconnect
                    ) : (
                      zhCN.plugins.connect
                    )}
                  </button>
                </div>
              );
            })
          )}
          {cards !== null && visible.length === 0 && (
            <div className="py-8 text-center text-[13px] text-ink-secondary">{zhCN.plugins.noAppsMatch}</div>
          )}
        </div>
      </div>
    </div>
  );
}
