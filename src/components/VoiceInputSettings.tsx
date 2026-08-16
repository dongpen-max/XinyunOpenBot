import { Activity, Gauge, Loader2, Mic, RotateCcw, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { listVoiceMicrophones, MicrophoneLevelMonitor, type MicrophoneSample } from "@/lib/voice/microphone";
import {
  calibrateVoiceActivity,
  normalizeVoiceActivityProfile,
  VOICE_ACTIVITY_PRESETS,
  VoiceActivityGate,
  voiceActivityOptions,
  type VoiceActivityProfile,
  type VoiceSensitivity,
} from "@/lib/voice/voice-activity";

export interface VoiceInputDraft {
  deviceId: string;
  profiles: Record<string, VoiceActivityProfile>;
}

interface VoiceInputSettingsProps {
  value: VoiceInputDraft;
  onChange: (next: VoiceInputDraft) => void;
  onCalibrationPlayback?: () => Promise<boolean>;
}

const LEVEL_CEILING = 0.15;
const SENSITIVITIES: Array<{ value: Exclude<VoiceSensitivity, "custom">; label: string; hint: string }> = [
  { value: "low", label: "低", hint: "扬声器外放环境更稳妥" },
  { value: "medium", label: "中", hint: "大多数耳机和笔记本" },
  { value: "high", label: "高", hint: "轻声说话也容易触发" },
];

export function VoiceInputSettings({ value, onChange, onCalibrationPlayback }: VoiceInputSettingsProps) {
  const monitor = useRef(new MicrophoneLevelMonitor());
  const valueRef = useRef(value);
  const gate = useRef(new VoiceActivityGate());
  const calibrationSamples = useRef<number[]>([]);
  const calibratingRef = useRef(false);
  const hotStartedAt = useRef<number | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [monitoring, setMonitoring] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const [level, setLevel] = useState(0);
  const [threshold, setThreshold] = useState(0.055);
  const [triggerCount, setTriggerCount] = useState(0);
  const [lastTriggerMs, setLastTriggerMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  valueRef.current = value;
  const profile = useMemo(
    () => normalizeVoiceActivityProfile(value.profiles[value.deviceId]),
    [value.deviceId, value.profiles],
  );

  useEffect(() => {
    gate.current = new VoiceActivityGate(voiceActivityOptions(profile));
    setThreshold(profile.minimumRms);
    hotStartedAt.current = null;
  }, [profile.minimumRms, profile.noiseRatio, profile.triggerFrames]);

  useEffect(() => {
    void listVoiceMicrophones().then(setDevices).catch(() => {});
    const mediaDevices = navigator.mediaDevices;
    const refresh = () => void listVoiceMicrophones().then(setDevices).catch(() => {});
    mediaDevices?.addEventListener?.("devicechange", refresh);
    return () => {
      mediaDevices?.removeEventListener?.("devicechange", refresh);
      monitor.current.stop();
    };
  }, []);

  const updateProfile = (next: VoiceActivityProfile) => {
    const current = valueRef.current;
    onChange({
      ...current,
      profiles: { ...current.profiles, [current.deviceId]: normalizeVoiceActivityProfile(next) },
    });
  };

  const onSample = (sample: MicrophoneSample) => {
    setLevel(sample.rms);
    if (calibratingRef.current) calibrationSamples.current.push(sample.rms);
    const fired = gate.current.update(sample.rms);
    const diagnostics = gate.current.diagnostics;
    setThreshold(diagnostics.threshold);
    if (diagnostics.hotFrames === 1 && hotStartedAt.current === null) hotStartedAt.current = sample.at;
    if (diagnostics.hotFrames === 0) hotStartedAt.current = null;
    if (!fired) return;
    setTriggerCount((count) => count + 1);
    setLastTriggerMs(Math.max(0, Math.round(sample.at - (hotStartedAt.current ?? sample.at))));
    hotStartedAt.current = null;
    const active = normalizeVoiceActivityProfile(valueRef.current.profiles[valueRef.current.deviceId]);
    gate.current = new VoiceActivityGate(voiceActivityOptions(active));
  };

  const startMonitoring = async (): Promise<boolean> => {
    setError(null);
    try {
      await monitor.current.start(valueRef.current.deviceId, onSample);
      setMonitoring(true);
      setDevices(await listVoiceMicrophones());
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setMonitoring(false);
      return false;
    }
  };

  const stopMonitoring = () => {
    monitor.current.stop();
    setMonitoring(false);
    setLevel(0);
    calibratingRef.current = false;
    setCalibrating(false);
  };

  const selectDevice = (deviceId: string) => {
    stopMonitoring();
    onChange({ ...valueRef.current, deviceId });
    setTriggerCount(0);
    setLastTriggerMs(null);
  };

  const chooseSensitivity = (sensitivity: VoiceSensitivity) => {
    if (sensitivity === "custom") return updateProfile({ ...profile, sensitivity });
    updateProfile({ ...VOICE_ACTIVITY_PRESETS[sensitivity] });
  };

  const calibrate = async () => {
    if (calibrating) return;
    if (!monitoring && !(await startMonitoring())) return;
    setError(null);
    calibrationSamples.current = [];
    calibratingRef.current = true;
    setCalibrating(true);
    try {
      const playback = onCalibrationPlayback?.();
      await new Promise((resolve) => window.setTimeout(resolve, 4_000));
      const result = calibrateVoiceActivity(calibrationSamples.current, profile);
      updateProfile({
        ...profile,
        minimumRms: result.minimumRms,
        calibratedNoiseFloor: result.noiseFloor,
        calibratedAt: new Date().toISOString(),
      });
      await playback;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      calibratingRef.current = false;
      setCalibrating(false);
    }
  };

  const levelPercent = Math.min(100, (level / LEVEL_CEILING) * 100);
  const thresholdPercent = Math.min(100, (threshold / LEVEL_CEILING) * 100);
  const deviceLabel = (device: MediaDeviceInfo, index: number) => device.label || `麦克风 ${index + 1}`;
  const selectableDevices = devices.filter((device) => device.deviceId && device.deviceId !== "default");
  const selectedDeviceMissing = value.deviceId !== "default" && !selectableDevices.some((device) => device.deviceId === value.deviceId);

  return (
    <div className="mt-1 border-y border-hairline/30 py-3">
      <div className="flex items-start justify-between gap-3">
        <span>
          <span className="flex items-center gap-1.5 text-[13px] font-medium text-ink"><Mic size={14} /> 麦克风与抢断</span>
          <span className="mt-0.5 block text-[11px] text-ink-secondary">只在本机检测音量，不录制、不上传监听音频</span>
        </span>
        <button
          type="button"
          onClick={() => (monitoring ? stopMonitoring() : void startMonitoring())}
          className={cn("rounded-lg bg-raised px-2.5 py-1.5 text-[11.5px] text-ink hover:bg-raised-hover", monitoring && "text-accent")}
        >
          {monitoring ? "停止测试" : "测试我的声音"}
        </button>
      </div>

      <label className="mt-3 block">
        <span className="mb-1.5 block text-[11.5px] text-ink-secondary">输入设备</span>
        <select
          value={value.deviceId}
          onChange={(event) => selectDevice(event.target.value)}
          className="w-full rounded-lg border border-hairline/40 bg-card px-3 py-2 text-[12px] text-ink focus:outline-none"
          aria-label="语音输入设备"
        >
          <option value="default">系统默认麦克风</option>
          {selectedDeviceMissing && <option value={value.deviceId}>已保存的麦克风（当前不可用）</option>}
          {selectableDevices.map((device, index) => (
            <option key={device.deviceId} value={device.deviceId}>{deviceLabel(device, index)}</option>
          ))}
        </select>
      </label>

      <div className="mt-3 rounded-lg border border-hairline/30 bg-card px-3 py-2.5">
        <div className="flex items-center justify-between text-[11px] text-ink-secondary">
          <span className="flex items-center gap-1"><Activity size={12} /> 实时输入电平</span>
          <span className="font-mono">{level.toFixed(3)} RMS</span>
        </div>
        <div
          className="relative mt-2 h-2 overflow-hidden rounded-full bg-raised"
          role="progressbar"
          aria-label="实时麦克风输入电平"
          aria-valuemin={0}
          aria-valuemax={LEVEL_CEILING}
          aria-valuenow={Math.min(LEVEL_CEILING, level)}
        >
          <div className="h-full rounded-full bg-accent transition-[width] duration-75" style={{ width: `${levelPercent}%` }} />
          <div className="absolute inset-y-0 w-px bg-warning" style={{ left: `${thresholdPercent}%` }} title="当前触发阈值" />
        </div>
        <div className="mt-1.5 flex justify-between text-[10.5px] text-ink-secondary/75">
          <span>阈值 {threshold.toFixed(3)}</span>
          <span>触发 {triggerCount} 次{lastTriggerMs === null ? "" : ` · ${lastTriggerMs} ms`}</span>
        </div>
      </div>

      <div className="mt-3">
        <div className="mb-1.5 flex items-center justify-between text-[11.5px] text-ink-secondary">
          <span className="flex items-center gap-1"><Gauge size={12} /> 抢断灵敏度</span>
          <span>约 {profile.triggerFrames * 50} ms 持续声音触发</span>
        </div>
        <div className="grid grid-cols-4 gap-1 rounded-lg bg-card p-1">
          {SENSITIVITIES.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => chooseSensitivity(option.value)}
              title={option.hint}
              aria-pressed={profile.sensitivity === option.value}
              className={cn("rounded-md px-2 py-1.5 text-[11.5px] text-ink-secondary hover:text-ink", profile.sensitivity === option.value && "bg-accent text-white")}
            >
              {option.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => chooseSensitivity("custom")}
            aria-pressed={profile.sensitivity === "custom"}
            className={cn("rounded-md px-2 py-1.5 text-[11.5px] text-ink-secondary hover:text-ink", profile.sensitivity === "custom" && "bg-accent text-white")}
          >
            自定义
          </button>
        </div>
      </div>

      {profile.sensitivity === "custom" && (
        <div className="mt-3 grid gap-2 border-t border-hairline/30 pt-3">
          <label className="text-[11px] text-ink-secondary">
            <span className="flex justify-between"><span>最低触发音量</span><span className="font-mono text-ink">{profile.minimumRms.toFixed(3)}</span></span>
            <input type="range" min="0.01" max="0.15" step="0.005" value={profile.minimumRms} onChange={(event) => updateProfile({ ...profile, minimumRms: Number(event.target.value) })} className="mt-1 w-full accent-accent" />
          </label>
          <label className="text-[11px] text-ink-secondary">
            <span className="flex justify-between"><span>环境噪声倍率</span><span className="font-mono text-ink">{profile.noiseRatio.toFixed(2)}×</span></span>
            <input type="range" min="1.1" max="4" step="0.1" value={profile.noiseRatio} onChange={(event) => updateProfile({ ...profile, noiseRatio: Number(event.target.value) })} className="mt-1 w-full accent-accent" />
          </label>
          <label className="text-[11px] text-ink-secondary">
            <span className="flex justify-between"><span>持续检测时间</span><span className="font-mono text-ink">{profile.triggerFrames * 50} ms</span></span>
            <input type="range" min="2" max="12" step="1" value={profile.triggerFrames} onChange={(event) => updateProfile({ ...profile, triggerFrames: Number(event.target.value) })} className="mt-1 w-full accent-accent" />
          </label>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-[10.5px] text-ink-secondary" aria-live="polite">
          {profile.calibratedNoiseFloor === undefined
            ? "尚未校准当前设备"
            : `已校准 · 泄漏基线 ${profile.calibratedNoiseFloor.toFixed(3)} RMS`}
        </span>
        <div className="flex gap-1.5">
          <button type="button" onClick={() => updateProfile({ ...VOICE_ACTIVITY_PRESETS.medium })} className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] text-ink-secondary hover:bg-raised hover:text-ink">
            <RotateCcw size={11} /> 默认
          </button>
          <button type="button" onClick={() => void calibrate()} disabled={calibrating} className="flex items-center gap-1 rounded-lg bg-raised px-2.5 py-1.5 text-[11px] text-ink hover:bg-raised-hover disabled:opacity-50">
            {calibrating ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
            {calibrating ? "正在播放并校准" : "自动校准"}
          </button>
        </div>
      </div>
      {error && <div className="mt-2 text-[11.5px] text-danger">{error}</div>}
    </div>
  );
}
