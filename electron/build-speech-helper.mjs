import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const electronDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.dirname(electronDir);
const resourcesDir = path.join(electronDir, "resources");

export const speechHelperBundle = path.join(resourcesDir, "XinyunOpen Bot Speech.app");
export const speechHelperBinary = path.join(
  speechHelperBundle,
  "Contents",
  "MacOS",
  "speech-helper",
);

export function buildSpeechHelper() {
  if (process.platform !== "darwin") {
    throw new Error("build:speech 只能在 macOS 上运行");
  }
  const contents = path.join(speechHelperBundle, "Contents");
  mkdirSync(path.join(contents, "MacOS"), { recursive: true });
  copyFileSync(
    path.join(resourcesDir, "speech-helper-Info.plist"),
    path.join(contents, "Info.plist"),
  );
  execFileSync(
    "swiftc",
    ["-O", path.join(resourcesDir, "speech-helper.swift"), "-o", speechHelperBinary],
    { stdio: "inherit", timeout: 120_000 },
  );
  execFileSync(
    "/usr/bin/codesign",
    [
      "--force",
      "--deep",
      "--sign",
      "-",
      "--options",
      "runtime",
      "--entitlements",
      path.join(projectDir, "build", "entitlements.mac.plist"),
      speechHelperBundle,
    ],
    { stdio: "inherit", timeout: 30_000 },
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  buildSpeechHelper();
}
