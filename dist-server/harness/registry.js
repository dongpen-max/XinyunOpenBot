import { redactProviderText } from "../provider-errors.js";
export class ProviderRegistry {
    byId = new Map();
    driversByKind;
    constructor(drivers) {
        this.driversByKind = new Map(drivers.map((d) => [d.driverKind, d]));
    }
    async load(configs) {
        for (const [instanceId, entry] of Object.entries(configs)) {
            const driver = this.driversByKind.get(entry.driver);
            if (!driver) {
                this.byId.set(instanceId, {
                    instanceId,
                    shadow: {
                        instanceId,
                        driverKind: entry.driver,
                        displayName: entry.displayName,
                        shadow: true,
                        reason: `unknown driver "${entry.driver}" — kept as configured, unavailable here`,
                    },
                });
                continue;
            }
            try {
                const config = entry.config === undefined ? driver.defaultConfig() : driver.decodeConfig(entry.config);
                const live = await driver.create({
                    instanceId,
                    displayName: entry.displayName ?? driver.metadata.displayName,
                    environment: entry.environment ?? {},
                    enabled: entry.enabled ?? true,
                    config,
                });
                this.byId.set(instanceId, { instanceId, live });
            }
            catch (e) {
                this.byId.set(instanceId, {
                    instanceId,
                    shadow: {
                        instanceId,
                        driverKind: entry.driver,
                        displayName: entry.displayName ?? driver.metadata.displayName,
                        shadow: true,
                        reason: redactProviderText(e instanceof Error ? e.message : String(e)),
                    },
                });
            }
        }
    }
    get(instanceId) {
        return this.byId.get(instanceId)?.live ?? null;
    }
    entries() {
        return [...this.byId.values()];
    }
    instances() {
        return [...this.byId.values()].flatMap((e) => (e.live ? [e.live] : []));
    }
    /** instance snapshots for the model picker/router: one capability source. */
    async describe(health) {
        return Promise.all(this.entries().map(async (entry) => {
            if (entry.shadow) {
                return {
                    instanceId: entry.instanceId,
                    driverKind: entry.shadow.driverKind,
                    displayName: entry.shadow.displayName ?? entry.shadow.driverKind,
                    snapshot: { state: "unavailable", reason: entry.shadow.reason },
                    models: { default: "", options: [] },
                    install: this.driversByKind.get(entry.shadow.driverKind)?.install,
                    capabilities: {
                        textChat: false,
                        reasoningLevels: [],
                        coding: null,
                        agentTools: false,
                        mcpTools: false,
                        imageInput: null,
                        imageGeneration: null,
                        localComputer: false,
                        cloudComputer: false,
                        browser: false,
                        maxContextTokens: null,
                        sessionResume: false,
                        streaming: null,
                        available: false,
                        computerTools: false,
                        reasoningEffort: false,
                    },
                    health: health?.snapshot(entry.instanceId),
                };
            }
            const inst = entry.live;
            let snapshot;
            try {
                snapshot = await inst.snapshot();
                if (snapshot.reason)
                    snapshot = { ...snapshot, reason: redactProviderText(snapshot.reason) };
            }
            catch (e) {
                snapshot = { state: "unavailable", reason: redactProviderText(e instanceof Error ? e.message : String(e)) };
            }
            const instanceHealth = health?.snapshot(inst.instanceId);
            const instanceCanAttempt = !instanceHealth || (instanceHealth.circuitState !== "open" &&
                !(instanceHealth.circuitState === "half_open" && instanceHealth.activeRequests > 0));
            const standard = {
                textChat: snapshot.state === "available",
                reasoningLevels: inst.adapter.capabilities.reasoningEffort ? ["low", "medium", "high"] : [],
                coding: inst.adapter.capabilities.coding ?? null,
                agentTools: inst.adapter.capabilities.agentsMcp === true,
                mcpTools: inst.adapter.capabilities.mcpTools === true,
                imageInput: inst.adapter.capabilities.imageInput ?? null,
                imageGeneration: inst.adapter.capabilities.imageGeneration ?? null,
                localComputer: inst.adapter.capabilities.computerMode === "mcp",
                cloudComputer: inst.adapter.capabilities.computerMode !== undefined,
                browser: inst.adapter.capabilities.browser ?? inst.adapter.capabilities.computerMode !== undefined,
                maxContextTokens: inst.adapter.capabilities.maxContextTokens ?? null,
                sessionResume: inst.adapter.capabilities.sessionResume === true,
                streaming: inst.adapter.capabilities.streaming ?? null,
                available: snapshot.state === "available" && instanceCanAttempt,
            };
            return {
                instanceId: inst.instanceId,
                driverKind: inst.driverKind,
                displayName: inst.displayName ?? inst.driverKind,
                snapshot,
                models: {
                    ...inst.models,
                    options: inst.models.options.map((model) => {
                        const modelHealth = health?.snapshot(inst.instanceId, model.id);
                        const modelCanAttempt = !modelHealth || (modelHealth.circuitState !== "open" &&
                            !(modelHealth.circuitState === "half_open" && modelHealth.activeRequests > 0));
                        return {
                            ...model,
                            capabilities: {
                                ...standard,
                                ...model.capabilities,
                                available: standard.available && modelCanAttempt,
                            },
                            health: modelHealth,
                        };
                    }),
                },
                install: this.driversByKind.get(inst.driverKind)?.install,
                capabilities: {
                    ...standard,
                    // Compatibility aliases are projections of the same manifest.
                    computerTools: standard.cloudComputer || standard.localComputer,
                    reasoningEffort: inst.adapter.capabilities.reasoningEffort === true,
                },
                health: instanceHealth,
            };
        }));
    }
    async disposeAll() {
        await Promise.allSettled(this.instances().map((i) => i.dispose()));
        this.byId.clear();
    }
}
