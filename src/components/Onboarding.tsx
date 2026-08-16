import { useEffect, useState } from "react";
import { Check, AlertTriangle, Loader2, Mic } from "lucide-react";
import { MausAvatar } from "./Avatar";
import { identifyEmail, setEmailGateDone, track } from "@/lib/analytics";
import { zhCN } from "@/locales/zh-CN";

// Three-step first-run onboarding: who you are (email), what's installed
// (live engine checks from the harness), what the app may use (TCC).
// Every check is skippable — onboarding must never brick the app.

type InstanceRow = {
  instanceId: string;
  driverKind: string;
  displayName: string;
  snapshot: { state: "available" | "unavailable"; reason?: string; version?: string | null; authenticated?: boolean };
  install?: { docsUrl?: string; signInCommand?: string };
};

const isElectron = navigator.userAgent.includes("Electron");
const isMacElectron = isElectron && window.ogb?.platform === "darwin";

function StatusRow({
  ok,
  warn,
  title,
  detail,
}: {
  ok: boolean;
  warn?: boolean;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-card p-3.5">
      <span
        className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full ${
          ok ? "bg-[#00c97222] text-[#38d591]" : warn ? "bg-[#ff980022] text-[#ff9800]" : "bg-raised text-ink-secondary"
        }`}
      >
        {ok ? <Check size={14} /> : <AlertTriangle size={13} />}
      </span>
      <div className="min-w-0">
        <div className="text-[14px] font-medium text-ink">{title}</div>
        <div className="mt-0.5 text-[12.5px] leading-relaxed text-ink-secondary">{detail}</div>
      </div>
    </div>
  );
}

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [instances, setInstances] = useState<InstanceRow[] | null>(null);
  const [perms, setPerms] = useState<{ mic: string } | null>(null);
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
  const micPermissionDetail =
    perms?.mic === "granted"
      ? "麦克风权限已授权，可以使用语音输入和语音通话。"
      : perms?.mic === "denied" || perms?.mic === "restricted"
        ? "麦克风权限已被拒绝，请在系统设置中允许 XinyunOpen Bot 使用麦克风。"
        : perms?.mic === "not-determined"
          ? "尚未请求麦克风权限，点击启用后 macOS 会显示系统授权窗口。"
          : zhCN.onboarding.micPermissionDesc;

  const saveProfile = () => {
    identifyEmail(email.trim().toLowerCase());
    // persisted server-side (~/.openmausbot/config.json) — the sidebar
    // footer reads it back through /api/config
    void fetch("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: { name: name.trim(), email: email.trim().toLowerCase() } }),
    }).catch(() => {});
    setStep(1);
  };

  useEffect(() => {
    track("onboarding_step", { step });
    if (step === 1 && !instances) {
      fetch("/api/instances")
        .then((r) => r.json())
        .then((d) => setInstances(d.instances ?? []))
        .catch(() => setInstances([]));
    }
    if (step === 2 && isMacElectron) {
      const poll = () => window.ogb?.permStatus?.().then(setPerms).catch(() => {});
      poll();
      // keep polling — the user may grant in System Settings and come back
      const t = setInterval(poll, 2000);
      return () => clearInterval(t);
    }
  }, [step, instances]);

  const finish = () => {
    track("onboarding_completed", {
      engines_available: instances?.filter((i) => i.snapshot.state === "available").length ?? -1,
      mic: perms?.mic ?? "n/a",
    });
    setEmailGateDone("submitted");
    onDone();
  };

  const byKind = (kind: string) => instances?.find((i) => i.driverKind === kind);
  const claude = byKind("claudeAgent");
  const codex = byKind("codex");
  const grok = byKind("grokAgent");
  const antigravity = byKind("antigravityAgent");
  const kimi = byKind("kimiAgent");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-app">
      <div className="flex w-[460px] flex-col rounded-2xl border border-hairline/40 bg-panel p-8">
        {step === 0 && (
          <div className="flex flex-col items-center">
            <MausAvatar color="green" state="happy" size={72} />
            <h1 className="mt-4 text-[20px] font-semibold text-ink">{zhCN.onboarding.welcome}</h1>
            <p className="mt-1.5 text-center text-[14px] leading-relaxed text-ink-secondary">
              {zhCN.onboarding.welcomeDesc}
            </p>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={zhCN.onboarding.yourName}
              className="mt-5 w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2.5 text-[15px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none"
            />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && valid && saveProfile()}
              placeholder={zhCN.onboarding.yourEmail}
              className="mt-3 w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2.5 text-[15px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none"
            />
            <button
              onClick={saveProfile}
              disabled={!valid}
              className="mt-3 w-full rounded-lg bg-accent py-2.5 text-[15px] font-medium text-white disabled:opacity-40"
            >
              {zhCN.onboarding.continue}
            </button>
            <button
              onClick={() => {
                track("email_skipped");
                setStep(1);
              }}
              className="mt-3 text-[12px] text-ink-secondary hover:text-ink"
            >
              {zhCN.onboarding.maybeLater}
            </button>
          </div>
        )}

        {step === 1 && (
          <div className="flex flex-col">
            <h1 className="text-[18px] font-semibold text-ink">{zhCN.onboarding.yourEngines}</h1>
            <p className="mt-1 text-[13.5px] text-ink-secondary">
              {zhCN.onboarding.enginesDesc}
            </p>
            <div className="mt-4 flex flex-col gap-2.5">
              {!instances ? (
                <div className="flex items-center gap-2 py-6 text-ink-secondary">
                  <Loader2 size={16} className="animate-spin" /> {zhCN.onboarding.checking}
                </div>
              ) : (
                <>
                  <StatusRow
                    ok={kimi?.snapshot.state === "available" && (kimi?.snapshot.authenticated ?? false)}
                    warn
                    title={`Kimi Code ${kimi?.snapshot.version ? `· ${kimi.snapshot.version.split(" ")[0]}` : ""}`}
                    detail={
                      kimi?.snapshot.state === "available"
                        ? kimi.snapshot.authenticated
                          ? "Kimi Code 已登录，可用于 Kimi 模型。"
                          : `未登录${kimi.install?.signInCommand ? `，请在终端执行 ${kimi.install.signInCommand}` : ""}`
                        : `可选。${kimi?.install?.docsUrl ? ` 安装文档：${kimi.install.docsUrl}` : ""}`
                    }
                  />
                  <StatusRow
                    ok={claude?.snapshot.state === "available" && (claude?.snapshot.authenticated ?? false)}
                    warn
                    title={`Claude Code ${claude?.snapshot.version ? `· ${claude.snapshot.version.split(" ")[0]}` : ""}`}
                    detail={
                      claude?.snapshot.state === "available"
                        ? claude.snapshot.authenticated
                          ? zhCN.onboarding.claudeReady
                          : zhCN.onboarding.claudeNotAuth
                        : zhCN.onboarding.claudeNotFound
                    }
                  />
                  <StatusRow
                    ok={codex?.snapshot.state === "available" || (codex?.snapshot.authenticated ?? false)}
                    warn
                    title={`Codex ${codex?.snapshot.version ? `· ${codex.snapshot.version.replace("codex-cli ", "")}` : ""}`}
                    detail={
                      codex?.snapshot.state === "available"
                        ? codex.snapshot.authenticated
                          ? zhCN.onboarding.codexApiReady
                          : zhCN.onboarding.codexReady
                        : zhCN.onboarding.codexNotFound
                    }
                  />
                  <StatusRow
                    ok={grok?.snapshot.state === "available" && (grok?.snapshot.authenticated ?? false)}
                    warn
                    title={`Grok Build ${grok?.snapshot.version ? `· ${grok.snapshot.version.split(" ")[1]}` : ""}`}
                    detail={
                      grok?.snapshot.state === "available"
                        ? grok.snapshot.authenticated
                          ? zhCN.onboarding.grokReady
                          : zhCN.onboarding.grokNotAuth
                        : zhCN.onboarding.grokNotFound
                    }
                  />
                  <StatusRow
                    ok={antigravity?.snapshot.state === "available"}
                    warn
                    title={`Antigravity ${antigravity?.snapshot.version ? `· ${antigravity.snapshot.version.split(" ")[0]}` : ""}`}
                    detail={
                      antigravity?.snapshot.state === "available"
                        ? "已安装 — 机器人也可以使用 Antigravity 工作。"
                        : "可选安装，请参考 antigravity.google/docs/cli"
                    }
                  />
                </>
              )}
            </div>
            <button
              onClick={() => (isMacElectron ? setStep(2) : finish())}
              className="mt-5 w-full rounded-lg bg-accent py-2.5 text-[15px] font-medium text-white"
            >
              {zhCN.onboarding.continue}
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col">
            <h1 className="text-[18px] font-semibold text-ink">{zhCN.onboarding.permissions}</h1>
            <p className="mt-1 text-[13.5px] text-ink-secondary">
              {zhCN.onboarding.permissionsDesc}
            </p>
            <div className="mt-4 flex flex-col gap-2.5">
              <div className="flex items-center justify-between gap-3 rounded-xl bg-card p-3.5">
                <div className="flex items-start gap-3">
                  <Mic size={18} className="mt-0.5 shrink-0 text-ink-secondary" />
                  <div>
                    <div className="text-[14px] font-medium text-ink">{zhCN.onboarding.micPermission}</div>
                    <div className="mt-0.5 text-[12.5px] text-ink-secondary">
                      {micPermissionDetail}
                    </div>
                  </div>
                </div>
                {perms?.mic === "granted" ? (
                  <Check size={16} className="shrink-0 text-[#38d591]" />
                ) : perms?.mic === "denied" || perms?.mic === "restricted" ? (
                  <button
                    onClick={() => window.ogb?.permOpenSettings?.("mic")}
                    className="shrink-0 rounded-lg bg-raised px-3 py-1.5 text-[13px] text-ink hover:bg-raised-hover"
                  >
                    {zhCN.onboarding.openSettings}
                  </button>
                ) : (
                  <button
                    onClick={() =>
                      window.ogb?.permRequestMic?.().then(() => window.ogb?.permStatus?.().then(setPerms))
                    }
                    className="shrink-0 rounded-lg bg-raised px-3 py-1.5 text-[13px] text-ink hover:bg-raised-hover"
                  >
                    {zhCN.onboarding.enable}
                  </button>
                )}
              </div>
            </div>
            <button onClick={finish} className="mt-5 w-full rounded-lg bg-accent py-2.5 text-[15px] font-medium text-white">
              {zhCN.onboarding.startUsing}
            </button>
            <button onClick={finish} className="mt-3 text-[12px] text-ink-secondary hover:text-ink">
              {zhCN.onboarding.skipForNow}
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
