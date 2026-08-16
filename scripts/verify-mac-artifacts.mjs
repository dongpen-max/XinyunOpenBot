import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

if (process.platform !== "darwin") throw new Error("macOS artifact verification must run on macOS");

const root = path.resolve(process.argv[2] ?? "release");
const files = readdirSync(root).filter((name) => statSync(path.join(root, name)).isFile());
const dmg = files.find((name) => name.endsWith(".dmg"));
const zip = files.find((name) => name.endsWith(".zip"));
const metadata = files.find((name) => name === "latest-mac.yml");
if (!dmg || !zip || !metadata) {
  throw new Error(`missing mac artifacts: dmg=${dmg}, zip=${zip}, latest-mac.yml=${metadata}`);
}

const latest = readFileSync(path.join(root, metadata), "utf8");
if (!latest.includes(zip) || !/sha512:\s*\S+/.test(latest)) {
  throw new Error("latest-mac.yml does not reference the generated ZIP with a sha512 digest");
}

const appDirs = ["mac-arm64", "mac", "mac-x64"];
const appDir = appDirs
  .map((dir) => path.join(root, dir, "XinyunOpen Bot.app"))
  .find((candidate) => {
    try {
      return statSync(candidate).isDirectory();
    } catch {
      return false;
    }
  });
if (!appDir) throw new Error("packaged XinyunOpen Bot.app was not found");

const plist = path.join(appDir, "Contents", "Info.plist");
for (const key of [
  "NSMicrophoneUsageDescription",
  "NSSpeechRecognitionUsageDescription",
  "NSAccessibilityUsageDescription",
  "NSScreenCaptureUsageDescription",
]) {
  const value = execFileSync("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, plist], {
    encoding: "utf8",
  }).trim();
  if (!value) throw new Error(`missing ${key} in packaged Info.plist`);
}

const helper = path.join(appDir, "Contents", "Resources", "XinyunOpen Bot Speech.app");
const cua = path.join(appDir, "Contents", "Resources", "cua-driver");
execFileSync("/usr/bin/test", ["-x", path.join(helper, "Contents", "MacOS", "speech-helper")]);
execFileSync("/usr/bin/test", ["-x", cua]);

const sums = [dmg, zip, metadata].map((name) => {
  const bytes = readFileSync(path.join(root, name));
  return `${createHash("sha256").update(bytes).digest("hex")}  ${name}`;
});
writeFileSync(path.join(root, "SHA256SUMS.txt"), `${sums.join("\n")}\n`);

let signing = "unsigned-or-ad-hoc";
try {
  execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=2", appDir], {
    stdio: "inherit",
  });
  const result = spawnSync("/usr/bin/codesign", ["-dv", "--verbose=4", appDir], {
    encoding: "utf8",
    timeout: 5000,
  });
  const details = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (/Developer ID Application/.test(details)) signing = "developer-id";
} catch {
  // Unsigned test artifacts are allowed; the workflow reports the state.
}

console.log(JSON.stringify({ root, appDir, dmg, zip, metadata, signing }, null, 2));
