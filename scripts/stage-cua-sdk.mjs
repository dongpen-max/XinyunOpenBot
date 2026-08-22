// Stage the Windows-only CUA SDK with real files rather than pnpm junctions.
// electron-builder deliberately excludes node_modules from the app archive.
// Put the runtime under dist-server instead: dist-server is already copied as
// Resources/server, so this also avoids a second, builder-specific resource
// rule that can silently omit a staged directory on Windows.
import { cp, mkdir, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const stageRoot = join(root, "dist-server", "cua-sdk");
// Avoid the literal `node_modules` segment here. electron-builder filters
// node_modules below `extraResources`; the bridge imports this fixed runtime
// layout directly instead of relying on Node's package lookup.
const target = join(stageRoot, "packages");
const pnpmRoot = join(root, "node_modules", ".pnpm");
const pnpmEntries = await readdir(pnpmRoot);
async function packageRoot(specifier) {
  for (const entry of pnpmEntries) {
    try {
      return await realpath(join(pnpmRoot, entry, "node_modules", ...specifier.split("/")));
    } catch {
      // The pnpm store contains many unrelated package folders.
    }
  }
  throw new Error(`Missing CUA runtime package: ${specifier}`);
}

const packages = [
  "@trycua/cua-driver",
  "@trycua/cua-driver-win32-x64-msvc",
  "@ubjs/core",
  "@ubjs/node",
  "@ubjs/node-win32-x64-msvc",
];

await rm(stageRoot, { recursive: true, force: true });
for (const name of packages) {
  const source = await packageRoot(name);
  const destination = join(target, ...name.split("/"));
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true, dereference: true });
}

const cuaDriver = join(target, "@trycua", "cua-driver");

// The CUA SDK itself has only two package-name imports. Repoint them to the
// colocated staged copy, and replace its generic platform resolver with the
// known Windows package sibling. This preserves all native SDK code while
// making the copied runtime independent of a `node_modules` directory.
for (const entry of await readdir(join(cuaDriver, "dist", "native"))) {
  if (!entry.endsWith(".js") || entry === "node-runtime.js") continue;
  const file = join(cuaDriver, "dist", "native", entry);
  const source = await readFile(file, "utf8");
  const patched = source.replaceAll('from "@ubjs/core"', 'from "../../../../@ubjs/core/dist/esm/index.js"');
  if (patched !== source) await writeFile(file, patched);
}

await writeFile(
  join(cuaDriver, "dist", "native", "node-runtime.js"),
  `import { createRequire } from "node:module";\n` +
    `import { dirname, join } from "node:path";\n` +
    `import { fileURLToPath } from "node:url";\n` +
    `const packageDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))));\n` +
    `const nativePackage = join(dirname(packageDir), "cua-driver-win32-x64-msvc");\n` +
    `const sdkLibrary = join(nativePackage, "cua_driver_sdk.dll");\n` +
    `const runtimePath = join(nativePackage, "cua_driver_node_runtime.node");\n` +
    `const require = createRequire(import.meta.url);\n` +
    `const { UniffiNativeModule } = require(runtimePath);\n` +
    `const FfiType = { UInt8:{tag:"UInt8"}, Int8:{tag:"Int8"}, UInt16:{tag:"UInt16"}, Int16:{tag:"Int16"}, UInt32:{tag:"UInt32"}, Int32:{tag:"Int32"}, UInt64:{tag:"UInt64"}, Int64:{tag:"Int64"}, Float32:{tag:"Float32"}, Float64:{tag:"Float64"}, Handle:{tag:"Handle"}, RustBuffer:{tag:"RustBuffer"}, ForeignBytes:{tag:"ForeignBytes"}, RustCallStatus:{tag:"RustCallStatus"}, VoidPointer:{tag:"VoidPointer"}, Void:{tag:"Void"}, Callback:(name)=>({tag:"Callback",name}), Struct:(name)=>({tag:"Struct",name}), Reference:(inner)=>({tag:"Reference",inner}), MutReference:(inner)=>({tag:"MutReference",inner}) };\n` +
    `export default { FfiType, resolveLibPath: () => sdkLibrary, UniffiNativeModule };\n`,
);
