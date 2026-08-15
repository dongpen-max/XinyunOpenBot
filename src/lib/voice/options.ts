export type VoiceProvider = "openai" | "siliconflow";

export const SILICONFLOW_MODEL = "FunAudioLLM/CosyVoice2-0.5B";
export const SILICONFLOW_VOICES = [
  ["alex", "Alex · 沉稳男声"],
  ["benjamin", "Benjamin · 低沉男声"],
  ["charles", "Charles · 磁性男声"],
  ["david", "David · 活泼男声"],
  ["anna", "Anna · 沉稳女声"],
  ["bella", "Bella · 热情女声"],
  ["claire", "Claire · 温柔女声"],
  ["diana", "Diana · 活泼女声"],
] as const;

export const OPENAI_VOICES = [
  "alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse", "marin", "cedar",
];

export function voiceOptions(provider: VoiceProvider): Array<{ value: string; label: string }> {
  return provider === "siliconflow"
    ? SILICONFLOW_VOICES.map(([id, label]) => ({ value: `${SILICONFLOW_MODEL}:${id}`, label }))
    : OPENAI_VOICES.map((value) => ({ value, label: value }));
}
