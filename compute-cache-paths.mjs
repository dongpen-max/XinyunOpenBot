// Compute the exact electron-builder cache folder names for winCodeSign and nsis-bundle
// These paths depend on the MIRROR URL via hashUrlSafe()

import os from "os";
import path from "path";

function hashUrlSafe(input, length = 6) {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
  }
  hash >>>= 0;
  const out = hash.toString(36);
  return out.length >= length ? out.slice(0, length) : out.padStart(length, "0");
}

function getCacheDirectory() {
  const localAppData = process.env.LOCALAPPDATA?.trim();
  return path.join(localAppData, "electron-builder", "Cache");
}

function computeExtractDir(mirror, releaseName, filenameWithExt) {
  const baseUrl = mirror.endsWith("/") ? mirror : mirror + "/";
  const fullUrl = `${baseUrl}${releaseName}/${filenameWithExt}`;
  const suffix = hashUrlSafe(fullUrl, 5);
  const folderName = `${filenameWithExt.replace(/\.(tar\.gz|tgz|tar\.xz|txz|zip|7z)$/, "")}-${suffix}`;
  const cacheDir = getCacheDirectory();
  return {
    fullUrl,
    folderName,
    extractDir: path.join(cacheDir, releaseName, folderName),
    archiveCachePath: path.join(cacheDir, releaseName, filenameWithExt),
  };
}

const MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/";
const GITHUB  = "https://github.com/electron-userland/electron-builder-binaries/releases/download/";

const tools = [
  { release: "winCodeSign-2.6.0", file: "winCodeSign-2.6.0.7z" },
  { release: "nsis@3.12",         file: "nsis-bundle-3.12.tar.gz" },
];

for (const { release, file } of tools) {
  const mirror = computeExtractDir(MIRROR, release, file);
  const github = computeExtractDir(GITHUB, release, file);
  console.log(`\n=== ${release} ===`);
  console.log("MIRROR URL :", mirror.fullUrl);
  console.log("MIRROR dir :", mirror.extractDir);
  console.log("GITHUB URL :", github.fullUrl);
  console.log("GITHUB dir :", github.extractDir);
  console.log("archive    :", mirror.archiveCachePath);
}
