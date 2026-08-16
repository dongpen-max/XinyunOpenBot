const { execFile } = require("node:child_process");
const { mkdtemp, rm } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");

const run = promisify(execFile);

module.exports = async function notarize(context) {
  if (process.platform !== "darwin") return;
  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;
  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    console.log("[notarize] Apple 凭据未配置，跳过公证（测试产物仍会生成）");
    return;
  }

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);
  const signature = await run("/usr/bin/codesign", ["-dv", "--verbose=4", appPath]);
  const signatureDetails = `${signature.stdout ?? ""}\n${signature.stderr ?? ""}`;
  if (!/Authority=Developer ID Application:/i.test(signatureDetails)) {
    console.log("[notarize] 当前应用不是 Developer ID Application 签名，跳过公证");
    return;
  }
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "xinyun-notary-"));
  const archive = path.join(tempDir, "XinyunOpen-Bot.zip");
  try {
    await run("/usr/bin/ditto", ["-c", "-k", "--keepParent", appPath, archive]);
    await run(
      "/usr/bin/xcrun",
      [
        "notarytool",
        "submit",
        archive,
        "--apple-id",
        APPLE_ID,
        "--password",
        APPLE_APP_SPECIFIC_PASSWORD,
        "--team-id",
        APPLE_TEAM_ID,
        "--wait",
      ],
      { maxBuffer: 10 * 1024 * 1024 },
    );
    await run("/usr/bin/xcrun", ["stapler", "staple", appPath]);
    await run("/usr/bin/xcrun", ["stapler", "validate", appPath]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};
