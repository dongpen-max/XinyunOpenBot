export type ComputerPreference = "cloud" | "local" | "off" | undefined;

/** A bot-to-bot child turn must not queue for the workspace Box already
 * leased by its parent, otherwise ask_bot creates a circular wait. Peer turns
 * are delegated text tasks, so they always run without computer integration;
 * the user can start a separate top-level turn when cloud control is required. */
export function shouldUseCloudComputer(
  preference: ComputerPreference,
  computerMode: "mcp" | "native" | undefined,
  commsDepth: number,
): boolean {
  if (!computerMode || preference === "off" || preference === "local") return false;
  if (commsDepth > 0) return false;
  return true;
}
