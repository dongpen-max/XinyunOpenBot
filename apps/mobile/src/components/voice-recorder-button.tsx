import { RecordingPresets, requestRecordingPermissionsAsync, useAudioRecorder, useAudioRecorderState } from "expo-audio";
import { Pressable, StyleSheet, Text } from "react-native";
import { usePalette } from "@/hooks/use-palette";

export function VoiceRecorderButton({ onRecorded }: { onRecorded: (uri: string, durationMillis: number) => void }) {
  const palette = usePalette();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const status = useAudioRecorderState(recorder, 250);
  const toggle = async () => {
    if (status.isRecording) {
      await recorder.stop();
      if (recorder.uri) onRecorded(recorder.uri, status.durationMillis);
      return;
    }
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) return;
    await recorder.prepareToRecordAsync();
    recorder.record({ forDuration: 120 });
  };
  return <Pressable accessibilityLabel={status.isRecording ? "停止录音" : "录制语音"} onPress={() => void toggle()} style={[styles.button, { backgroundColor: status.isRecording ? palette.danger : palette.elevated }]}><Text style={{ color: status.isRecording ? "white" : palette.text }}>{status.isRecording ? `${Math.ceil(status.durationMillis / 1000)}s` : "🎙"}</Text></Pressable>;
}

const styles = StyleSheet.create({ button: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" } });
