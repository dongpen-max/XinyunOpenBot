// Canonical harness contracts — ported from upstream
// (apps/server/src/provider/ProviderDriver.ts, Services/ProviderAdapter.ts,
// packages/contracts/src/{provider,providerInstance,providerRuntime}.ts),
// de-Effect-ed: Promises instead of Effect, listener callbacks instead of
// Stream. The shapes and names are kept so the two codebases stay mutually
// readable.
/** Decode user-supplied model catalog from config (relay endpoints). Accepts
 * the full {default, options} shape or a string[] shorthand. Malformed entries
 * are skipped; if default is missing or not in the final list, the first
 * option is used. An empty result returns null (fall back to driver default). */
export function decodeModelCatalog(raw, fallback) {
    if (!raw || typeof raw !== "object")
        return fallback;
    const input = raw;
    let options = [];
    if (Array.isArray(input.options)) {
        for (const opt of input.options) {
            if (typeof opt === "string" && opt)
                options.push({ id: opt, label: opt });
            else if (opt && typeof opt === "object") {
                const o = opt;
                if (typeof o.id === "string" && o.id) {
                    options.push({ id: o.id, label: typeof o.label === "string" ? o.label : o.id });
                }
            }
        }
    }
    if (!options.length)
        return fallback;
    let defaultModel = typeof input.default === "string" ? input.default : "";
    if (!defaultModel || !options.some((o) => o.id === defaultModel))
        defaultModel = options[0].id;
    return { default: defaultModel, options };
}
let eventCounter = 0;
export const newEventId = () => `ev-${Date.now().toString(36)}-${(eventCounter++).toString(36)}`;
export const newId = () => crypto.randomUUID();
