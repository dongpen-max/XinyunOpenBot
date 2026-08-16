// PATH augmentation for GUI launches — the fix for "CLI not found" when
// the app is opened from Finder (issues #8, #12).
//
// A macOS app launched from Finder inherits a bare PATH
// (/usr/bin:/bin:...): no ~/.local/bin (the claude installer default),
// no /opt/homebrew/bin, and no nvm/volta/asdf shims — those only exist
// in interactive shells. The terminal sees the CLIs; the packaged app
// doesn't. So every spawn of an agent CLI goes through augmentedPath():
// the inherited PATH, plus the well-known install locations that exist
// on this machine, plus (async, best-effort) whatever PATH the user's
// real login shell reports.
import { execFile } from "node:child_process";
import { accessSync, closeSync, constants, existsSync, openSync, readFileSync, readSync, statSync, readdirSync, } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, dirname, extname, join, posix } from "node:path";
/** nvm keeps every node version's bin dir separately; newest first so a
 * CLI installed under the latest node wins. */
function nvmBinDirs() {
    try {
        const base = join(homedir(), ".nvm", "versions", "node");
        return readdirSync(base)
            .filter((v) => v.startsWith("v"))
            .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
            .map((v) => join(base, v, "bin"));
    }
    catch {
        return [];
    }
}
export function posixKnownDirs(home = homedir(), env = process.env, platform = process.platform) {
    const npmPrefix = env.npm_config_prefix ?? env.NPM_CONFIG_PREFIX;
    const pathJoin = platform === "darwin" || platform === "linux" ? posix.join : join;
    return [
        env.PNPM_HOME,
        npmPrefix ? pathJoin(npmPrefix, "bin") : undefined,
        pathJoin(home, ".local", "bin"), // claude installer default
        pathJoin(home, ".claude", "local"), // claude "local install"
        ...(platform === "darwin"
            ? [
                "/opt/homebrew/bin", // Homebrew, Apple Silicon
                "/usr/local/bin", // Homebrew, Intel / classic npm prefix
                "/usr/bin",
                pathJoin(home, "Library", "pnpm"),
            ]
            : ["/usr/local/bin", "/usr/bin"]),
        pathJoin(home, ".volta", "bin"),
        pathJoin(home, ".bun", "bin"),
        pathJoin(home, ".asdf", "shims"),
        pathJoin(home, ".deno", "bin"),
        pathJoin(home, "bin"),
        ...(home === homedir() ? nvmBinDirs() : []),
    ].filter((value) => Boolean(value));
}
/** Windows equivalents of knownDirs. A GUI app inherits the user PATH at
 * launch, but only at launch: a CLI installed while the app is running is
 * invisible until it restarts, because Windows never pushes PATH changes
 * into a live process. Scanning the standard install locations recovers
 * those without a restart — `~/.grok/bin` (the x.ai installer) and
 * `%APPDATA%\npm` (global npm shims), plus `%LOCALAPPDATA%\agy\bin`, cover
 * every engine we ship an install command for. */
function windowsKnownDirs() {
    const home = homedir();
    const appData = process.env.APPDATA ?? join(home, "AppData", "Roaming");
    const localAppData = process.env.LOCALAPPDATA ?? join(home, "AppData", "Local");
    return [
        join(appData, "npm"), // npm -g shims: claude, codex
        join(home, ".grok", "bin"), // x.ai installer
        join(localAppData, "agy", "bin"), // Antigravity installer
        join(home, ".local", "bin"), // claude native installer
        join(home, ".claude", "local"),
        join(home, ".bun", "bin"),
        join(home, ".deno", "bin"),
        join(home, "go", "bin"),
    ];
}
let cached = null;
let probed = false;
/** Drop the memoized PATH so the next augmentedPath() rescans. Called when
 * the app re-probes engines, so "check again" can find something installed
 * since launch instead of answering from the PATH we booted with. */
export function resetPathCache() {
    cached = null;
}
/** Current best PATH, synchronously. Cheap after the first call. */
export function augmentedPath() {
    if (cached === null) {
        cached = mergePaths([
            ...(process.env.OMB_EXTRA_PATH ? process.env.OMB_EXTRA_PATH.split(delimiter) : []),
            ...(process.env.PATH ? process.env.PATH.split(delimiter) : []),
            // Both platforms scan their standard install locations; only the
            // login-shell probe below stays unix-only, since Windows has no
            // equivalent rc file to source.
            ...(process.platform === "win32" ? windowsKnownDirs() : posixKnownDirs()).filter((d) => existsSync(d)),
        ]);
    }
    // belt-and-braces: fold in the login shell's PATH once, in the
    // background — catches anything the known-dirs list doesn't (custom
    // rc exports). Never blocks a spawn; the next one benefits.
    if (!probed && !process.env.VITEST && process.platform !== "win32") {
        probed = true;
        probeLoginShellPath();
    }
    return cached;
}
function mergePaths(parts) {
    return [...new Set(parts.filter(Boolean))].join(delimiter);
}
function probeLoginShellPath() {
    const shell = process.env.SHELL || "/bin/zsh";
    // -l -i: nvm and friends live in .zshrc/.bashrc, which only interactive
    // shells read. A marker isolates $PATH from any rc-file noise.
    execFile(shell, ["-l", "-i", "-c", 'printf "__OMB_PATH__%s" "$PATH"'], { timeout: 5000 }, (err, stdout) => {
        if (err || !stdout)
            return;
        const m = /__OMB_PATH__([^\n]*)/.exec(stdout);
        if (!m || !m[1])
            return;
        cached = mergePaths([...(cached ?? "").split(delimiter), ...m[1].split(delimiter)]);
    });
}
/** Test hook — the cache is process-wide otherwise. */
export function resetPathCacheForTests() {
    cached = null;
    probed = false;
}
function isFile(p) {
    try {
        return statSync(p, { throwIfNoEntry: false })?.isFile() ?? false;
    }
    catch {
        return false;
    }
}
function isExecutableFile(p) {
    if (!isFile(p))
        return false;
    try {
        accessSync(p, constants.X_OK);
        return true;
    }
    catch {
        return false;
    }
}
/** POSIX `which` with executable-bit validation. Exported for path tests and
 * for callers that need a concrete absolute CLI path in GUI launches. */
export function resolvePosixExecutable(cli, pathValue = augmentedPath()) {
    if (/[\\/]/.test(cli))
        return isExecutableFile(cli) ? cli : null;
    for (const dir of pathValue.split(delimiter)) {
        if (!dir)
            continue;
        const candidate = join(dir, cli);
        if (isExecutableFile(candidate))
            return candidate;
    }
    return null;
}
/** PATHEXT-aware `which`. A path-ish cli is probed where it points. */
function whichWin(cli) {
    const exts = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
    // an extensionless name is not runnable on Windows, so PATHEXT wins over
    // the bare file — npm installs both `claude` (a sh script) and `claude.cmd`
    const probe = (base) => {
        const order = extname(base) ? [base, ...exts.map((e) => base + e)] : [...exts.map((e) => base + e), base];
        return order.find(isFile) ?? null;
    };
    if (/[\\/]/.test(cli) || /^[a-zA-Z]:/.test(cli))
        return probe(cli);
    const preferNonWindowsApps = /^codex(?:\.(?:exe|cmd|bat|com))?$/i.test(cli);
    let firstHit = null;
    for (const dir of augmentedPath().split(delimiter)) {
        if (!dir)
            continue;
        const hit = probe(join(dir, cli));
        if (!hit)
            continue;
        firstHit ??= hit;
        // Microsoft Store exposes Codex from a protected WindowsApps package.
        // It can be visible to PATH discovery yet reject CreateProcess with
        // EPERM. A normal npm/global install later on PATH is the usable CLI.
        if (preferNonWindowsApps && /[\\/]WindowsApps[\\/]/i.test(hit))
            continue;
        return hit;
    }
    return firstHit;
}
/** node.exe to run a script with: the one npm's shim would pick, else PATH,
 * else this executable only when it really is Node. In a packaged app,
 * process.execPath is Electron and must never be mistaken for node.exe. */
function nodeExe(near) {
    const local = join(near, "node.exe");
    if (isFile(local))
        return local;
    // Ask for the executable explicitly so a custom PATHEXT ordering cannot
    // make a stray node.cmd hide the real node.exe beside it.
    const onPath = whichWin("node.exe");
    if (onPath && extname(onPath).toLowerCase() === ".exe")
        return onPath;
    return process.versions.electron ? null : process.execPath;
}
/** npm/pnpm .cmd shims all spell their target as "%dp0%\..." (or
 * "%~dp0\..."). Whatever of those exists on disk is what the shim runs. */
function parseCmdShim(shim) {
    let text;
    try {
        text = readFileSync(shim, "utf8");
    }
    catch {
        return null;
    }
    const dir = dirname(shim);
    const targets = [...text.matchAll(/"%~?dp0%?\\?([^"]+)"/g)]
        .map((m) => join(dir, m[1]))
        .filter((p) => isFile(p) && basename(p).toLowerCase() !== "node.exe");
    const script = targets.find((p) => /\.[cm]?js$/i.test(p));
    if (script) {
        const node = nodeExe(dir);
        if (node)
            return { command: node, args: [script] };
    }
    const exe = targets.find((p) => extname(p).toLowerCase() === ".exe");
    return exe ? { command: exe, args: [] } : null;
}
/** `#!/usr/bin/env node` → `node <script>`. Only node: nothing else has a
 * meaningful Windows equivalent worth guessing at. */
function parseNodeShebang(file) {
    let head = "";
    let fd = null;
    try {
        fd = openSync(file, "r");
        const buf = Buffer.alloc(128);
        const n = readSync(fd, buf, 0, buf.length, 0);
        head = buf.subarray(0, n).toString("utf8").split("\n", 1)[0];
    }
    catch {
        return null;
    }
    finally {
        if (fd !== null) {
            try {
                closeSync(fd);
            }
            catch {
                /* best-effort descriptor cleanup */
            }
        }
    }
    if (!/^#!.*\bnode(\.exe)?\b/.test(head))
        return null;
    const node = nodeExe(dirname(file));
    return node ? { command: node, args: [file] } : null;
}
/**
 * How to actually spawn `cli` with `args` on this platform. Identity
 * everywhere but win32 — POSIX already resolves PATH and #! itself.
 */
export function resolveCliSpawn(cli, args) {
    if (process.platform !== "win32") {
        return { command: resolvePosixExecutable(cli) ?? cli, args };
    }
    const file = whichWin(cli);
    // not found: hand back the name so spawn reports its own ENOENT
    if (!file)
        return { command: cli, args };
    const ext = extname(file).toLowerCase();
    if (ext === ".cmd" || ext === ".bat") {
        const direct = parseCmdShim(file);
        return direct ? { command: direct.command, args: [...direct.args, ...args] } : { command: file, args };
    }
    if (ext === ".exe" || ext === ".com")
        return { command: file, args };
    const viaNode = parseNodeShebang(file);
    return viaNode ? { command: viaNode.command, args: [...viaNode.args, ...args] } : { command: file, args };
}
