import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { chmod, copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";

if (process.platform !== "darwin") throw new Error("build:cua 只能在 macOS 上运行");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = promisify(execFile);
const stage = join(root, "dist-native");
const sdkEntry = fileURLToPath(import.meta.resolve("@trycua/cua-driver"));
const sdkRoot = realpathSync(join(dirname(sdkEntry), ".."));
const dependencyRoot = join(sdkRoot, "..", "..");
const sdkPackage = JSON.parse(await readFile(join(sdkRoot, "package.json"), "utf8"));
const expectedVersion = String(sdkPackage.version);
const release = {
  version: "0.19.3",
  file: "cua-driver-rs-0.19.3-darwin-universal-binary.tar.gz",
  sha256: "733e28a3782ac8d325f8fce8b5d97486c1054af755b40dfd086151b34c79377e",
};

if (expectedVersion !== release.version) {
  throw new Error(
    `CUA SDK ${expectedVersion} 没有固定的可执行文件校验和；请先更新 prepare-cua.mjs`,
  );
}
if (process.arch !== "arm64" && process.arch !== "x64") {
  throw new Error(`不支持的 macOS 架构：${process.arch}`);
}

async function binaryVersion(candidate) {
  if (!candidate || !existsSync(candidate)) return null;
  try {
    const { stdout } = await run(candidate, ["--version"], { timeout: 5000 });
    return stdout.match(/cua-driver\s+([\d.]+)/)?.[1] ?? null;
  } catch {
    return null;
  }
}

async function officialBinary() {
  const cache = join(root, "node_modules", ".cache", "xinyunopen-bot", `cua-driver-${release.version}`);
  const cachedBinary = join(cache, "cua-driver");
  if ((await binaryVersion(cachedBinary)) === expectedVersion) return cachedBinary;

  await rm(cache, { recursive: true, force: true });
  await mkdir(cache, { recursive: true });
  const url = `https://github.com/trycua/cua/releases/download/cua-driver-rs-v${release.version}/${release.file}`;
  const response = await fetch(url, { headers: { "user-agent": "XinyunOpenBot-packager" } });
  if (!response.ok) throw new Error(`CUA Driver 下载失败：HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== release.sha256) {
    throw new Error(`CUA Driver 校验和不匹配：expected ${release.sha256}, got ${digest}`);
  }
  const archive = join(cache, release.file);
  await writeFile(archive, bytes);
  await run("/usr/bin/tar", ["-xzf", archive, "-C", cache, "cua-driver"]);
  await chmod(cachedBinary, 0o755);
  if ((await binaryVersion(cachedBinary)) !== expectedVersion) {
    throw new Error(`下载的 CUA Driver 版本不是 ${expectedVersion}`);
  }
  return cachedBinary;
}

let binary;
if (process.env.CUA_DRIVER_PATH) {
  const suppliedVersion = await binaryVersion(process.env.CUA_DRIVER_PATH);
  if (suppliedVersion !== expectedVersion) {
    throw new Error(
      `CUA_DRIVER_PATH 必须指向 cua-driver ${expectedVersion}；当前为 ${suppliedVersion ?? "不可读取"}`,
    );
  }
  binary = process.env.CUA_DRIVER_PATH;
} else {
  const installed = "/Applications/CuaDriver.app/Contents/MacOS/cua-driver";
  binary = (await binaryVersion(installed)) === expectedVersion ? installed : await officialBinary();
}

const details = await stat(binary);
if (!details.isFile() || (details.mode & 0o111) === 0) {
  throw new Error(`cua-driver 不是可执行文件：${binary}`);
}

await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
await copyFile(binary, join(stage, "cua-driver"));
await chmod(join(stage, "cua-driver"), 0o755);
await run("/usr/bin/codesign", [
  "--force",
  "--sign",
  "-",
  "--options",
  "runtime",
  join(stage, "cua-driver"),
]);

const cuaSdkDir = join(stage, "cua-sdk");
const nativeDir = join(cuaSdkDir, "native");
const nativePackage = join(dependencyRoot, "@trycua", `cua-driver-darwin-${process.arch}`);
if (!existsSync(nativePackage)) {
  throw new Error(`缺少 CUA ${process.arch} 原生依赖：${nativePackage}`);
}
await mkdir(nativeDir, { recursive: true });
const resolvedNative = realpathSync(nativePackage);
await Promise.all([
  copyFile(join(resolvedNative, "libcua_driver_sdk.dylib"), join(nativeDir, "libcua_driver_sdk.dylib")),
  copyFile(join(resolvedNative, "cua_driver_node_runtime.node"), join(nativeDir, "cua_driver_node_runtime.node")),
]);

const bundle = join(cuaSdkDir, "cua-sdk.mjs");
await build({
  stdin: {
    contents: 'export { EmbeddedCuaDriverHost } from "@trycua/cua-driver/embedded";',
    resolveDir: root,
    sourcefile: "xinyun-cua-entry.mjs",
    loader: "js",
  },
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  banner: {
    js: 'import { createRequire as __xinyunCreateRequire } from "node:module"; const require = __xinyunCreateRequire(import.meta.url);',
  },
  outfile: bundle,
  logLevel: "silent",
});
const bundledSource = await readFile(bundle, "utf8");
const resolverPattern = /function resolveLibPath\d*\(opts\) \{/g;
const resolvers = bundledSource.match(resolverPattern) ?? [];
if (resolvers.length !== 1) throw new Error("无法定位 CUA 原生库解析器");
await writeFile(
  bundle,
  bundledSource.replace(
    resolverPattern,
    `${resolvers[0]}\n      if (process.env.XINYUN_CUA_SDK_LIBRARY) return resolveOverride(opts.crateName, process.env.XINYUN_CUA_SDK_LIBRARY);`,
  ),
);

console.log(`已为 ${process.arch} staging CUA：${binary}`);
