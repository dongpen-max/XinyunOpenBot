const DESKTOP_PLATFORMS = new Set(["darwin", "linux", "win32"]);

function normalizedPlatform(platform) {
  return DESKTOP_PLATFORMS.has(platform) ? platform : "other";
}

function localComputerReady(platform, connection) {
  return (
    platform === "darwin" &&
    (connection?.mode === "embedded" || connection?.mode === "standalone")
  );
}

function desktopCapabilities({ platform = process.platform, packaged = false, localConnection = null } = {}) {
  const hostPlatform = normalizedPlatform(platform);
  const isMac = hostPlatform === "darwin";
  const localAvailable = localComputerReady(hostPlatform, localConnection);
  return {
    host: { platform: hostPlatform, packaged: Boolean(packaged) },
    windowChrome: isMac ? "mac-inset" : "native",
    screenPreview: {
      available: isMac,
      ...(!isMac ? { reasonCode: "unsupported-platform" } : {}),
    },
    dictation: {
      available: isMac,
      engine: isMac ? "apple-speech" : "none",
      ...(!isMac ? { reasonCode: "unsupported-platform" } : {}),
    },
    localComputer: {
      available: localAvailable,
      ...(!localAvailable
        ? { reasonCode: isMac ? "cua-driver-unavailable" : "unsupported-platform" }
        : {}),
    },
  };
}

module.exports = { desktopCapabilities, localComputerReady };
