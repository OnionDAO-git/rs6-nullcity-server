import { BornResidentStore } from './born-resident-store';
import { EconomyEventLog } from './city-integration/economy-event';
import { CityIntegrationService, type BirthResidentRequest, cityInitialInventory, writeBirthSoulFile } from './city-integration/service';
import { ControllerConfig } from './config';
import { EvidenceStore, LibraryUpdater, TrajectoryBuilder } from './evidence';
import { FactionStockpileLedger } from './factions/stockpile-ledger';
import { GameSkillService } from './knowledge/game-skill-context';
import { createDefaultGameSkillEntries } from './knowledge/game-skill-entries';
import { KnowledgeSuggestionStore } from './knowledge/suggestions';
import { LlmClient } from './llm/llm-client';
import { ActionLog } from './logging/action-log';
import { InferenceLog } from './logging/inference-log';
import { LoreBus } from './lore/lore-bus';
import { MemoryStore } from './memory/memory-store';
import { type RuntimeState, RuntimeStateStore, residentSlug } from './memory/runtime-state';
import { CurrencyLedger } from './patron/currency-ledger';
import { PlanStore } from './intelligence/plan-store';
import { LettersStore } from './patron/letters-store';
import { recordSettledSupport } from './patron/settled-support';
import { PatronGateway } from './patron/patron-gateway';
import { PatronStore } from './patron/patron-store';
import { StandingLedger } from './patron/standing-ledger';
import { ResidentRuntime, type ResidentRuntimeEvidence, type ResidentRuntimeGameSkill } from './resident-runtime';
import { SoulLoader } from './soul/soul-loader';
import type { SparkModule } from './spark';
import { standardSparkModules } from './spark/standard-modules';
import { GatewayClient } from './transport/gateway-client';
import type { PerceptionEvent } from './transport/message-codecs';

const THINKING_WATCHDOG_ENDPOINT_GRACE_MS = 5_000;

export interface ControllerHostOptions {
    once?: boolean;
    logEnvelope?: boolean;
    gateway?: GatewayClient;
    cityGateway?: CityInventoryGateway;
    cityGatewayFactory?: () => CityInventoryGateway;
    soulLoader?: SoulLoader;
    memory?: MemoryStore;
    stateStore?: RuntimeStateStore;
    llm?: LlmClient;
    actionLog?: ActionLog;
    inferenceLog?: InferenceLog;
    gameSkill?: ResidentRuntimeGameSkill;
    sparkModules?: SparkModule[];
    runtimeFactory?: (options: ConstructorParameters<typeof ResidentRuntime>[0]) => ResidentRuntime;
    patronStore?: PatronStore;
    patronGateway?: PatronGateway;
    loreBus?: LoreBus;
    factionStockpile?: FactionStockpileLedger;
    /**
     * Optional shared {@link EconomyEventLog}. When omitted the host
     * constructs one rooted at `config.memory.dir`. The same instance is
     * exposed via {@link ControllerHost.getEconomyEventLog} so the city
     * integration layer (CityIntegrationService) and any future per-resident
     * emitters (ApLedger via `attachEconomyEventLog`) share one append-only
     * stream per memoryRoot. Packet S-HOST-WIRE.
     */
    economyEventLog?: EconomyEventLog;
}

export interface CityInventoryGateway {
    connect(): Promise<void>;
    hello(): Promise<void>;
    close(): void;
    inspectResidentGold(name: string): Promise<{ resident: string; itemId: 995; amount: number }>;
    burnResidentGold(
        name: string,
        amount: number,
    ): Promise<{ resident: string; itemId: 995; burnedAmount: number; remainingAmount: number }>;
}

function configuredThinkingWatchdogMs(config: ControllerConfig): number | undefined {
    const endpointTimeouts = Object.values(config.llm.endpoints)
        .map(endpoint => endpoint.timeoutMs)
        .filter(timeout => Number.isFinite(timeout) && timeout > 0);
    if (!endpointTimeouts.length) {
        return undefined;
    }
    return Math.max(...endpointTimeouts) + THINKING_WATCHDOG_ENDPOINT_GRACE_MS;
}

export class ControllerHost {
    private readonly gateway: GatewayClient;
    private readonly cityGateway?: CityInventoryGateway;
    private readonly cityGatewayFactory?: () => CityInventoryGateway;
    private readonly cityGatewayIsShared: boolean;
    private cityGatewaySeq = 0;
    private readonly runtimes = new Map<string, ResidentRuntime>();
    private readonly configuredDesired: Set<string>;
    private readonly desired: Set<string>;
    private readonly paused = new Set<string>();
    // Residents birthed at runtime via the City API (human-funded Soul
    // proposals). They are in neither config.residents nor soul discovery, so
    // refreshDesiredResidents() must union them in or the reconcile loop tears
    // their runtime down as `no_longer_desired` the tick after birth, orphaning
    // a funded Soul (connected to the world but unmanaged: no evidence session,
    // city API getRuntime() returns undefined). In-memory for now; cross-restart
    // persistence is handled by BornResidentStore (loaded in the constructor,
    // appended on birth) so born residents survive a controller restart.
    private readonly cityBorn = new Set<string>();
    private readonly bornStore: BornResidentStore;
    private readonly soulLoader: SoulLoader;
    private readonly memory: MemoryStore;
    private readonly planStore: PlanStore;
    private readonly stateStore: RuntimeStateStore;
    private readonly llm: LlmClient;
    private readonly actionLog: ActionLog;
    private readonly inferenceLog: InferenceLog;
    private readonly gameSkill: ResidentRuntimeGameSkill;
    private readonly sparkModules: SparkModule[];
    private reconcileTimer?: NodeJS.Timeout;
    private running = false;
    private lifecycleInFlight?: Promise<void>;
    private reconcileInFlight?: Promise<void>;
    private reconcileQueued = false;
    private readonly inFlightPerceptions = new Set<Promise<void>>();
    public readonly patronStore: PatronStore;
    public readonly patronGateway: PatronGateway;
    private readonly currencyLedger: CurrencyLedger;
    private readonly standingLedger: StandingLedger;
    // Onions-per-standing-point scale for the settled-support seam. Sourced from
    // config; falls back to the KNOWN-PLACEHOLDER 1:1 with a loud warning so the
    // 1:1 economy is never silently shipped (see resolveOnionsPerStandingPoint).
    private readonly onionsPerStandingPoint: number;
    // Extracted so both PatronGateway and the onPatronSupport callback share
    // the same LettersStore instance (same inbox root → same dedup index).
    private readonly lettersStore: LettersStore;
    public readonly loreBus: LoreBus;
    public readonly factionStockpile: FactionStockpileLedger;
    private readonly economyEventLog: EconomyEventLog;
    private readonly cityIntegrationService: CityIntegrationService;

    constructor(
        private readonly config: ControllerConfig,
        private readonly options: ControllerHostOptions = {},
    ) {
        const injectedGateway = options.gateway;
        this.gateway =
            injectedGateway ||
            new GatewayClient({
                url: config.gateway.url,
                authToken: config.gateway.authToken,
                controllerId: config.gateway.controllerId,
                reconnect: !options.once,
            });
        this.cityGateway = options.cityGateway || (options.cityGatewayFactory ? undefined : injectedGateway);
        this.cityGatewayFactory =
            options.cityGatewayFactory ||
            (this.cityGateway
                ? undefined
                : () =>
                      new GatewayClient({
                          url: config.gateway.url,
                          authToken: config.gateway.authToken,
                          controllerId: `${config.gateway.controllerId}:city:${process.pid}:${++this.cityGatewaySeq}`,
                          reconnect: false,
                          requestTimeoutMs: 20_000,
                          inventoryRequestTimeoutMs: 30_000,
                      }));
        this.cityGatewayIsShared = this.cityGateway === this.gateway;
        this.configuredDesired = new Set(config.residents);
        this.desired = new Set(config.residents);
        // Restore city-born residents persisted from prior runs so a controller
        // restart re-manages them instead of orphaning them ("none erased").
        this.bornStore = new BornResidentStore(config.memory.dir);
        for (const name of this.bornStore.list()) {
            this.cityBorn.add(name);
            this.desired.add(name);
        }
        this.soulLoader = options.soulLoader || new SoulLoader(config.souls.dir);
        this.memory = options.memory || new MemoryStore(config.memory.dir, config.memory.qmdBin);
        this.planStore = new PlanStore(config.memory.dir);
        this.stateStore = options.stateStore || new RuntimeStateStore(config.memory.dir);
        this.llm = options.llm || new LlmClient(config.llm.endpoints, config.inference.maxConcurrent);
        this.actionLog = options.actionLog || new ActionLog(config.logging.dir);
        this.inferenceLog = options.inferenceLog || new InferenceLog(config.logging.dir, Boolean(options.logEnvelope));
        this.sparkModules = options.sparkModules || standardSparkModules();
        this.gameSkill =
            options.gameSkill ||
            new GameSkillService({
                controllerId: config.gateway.controllerId,
                instanceId: config.controller.instanceId,
                entries: createDefaultGameSkillEntries(config.knowledge.runebenchWikiDir),
                suggestionStore: config.knowledge.enableSuggestions
                    ? new KnowledgeSuggestionStore({
                          root: config.knowledge.dir,
                          controllerId: config.gateway.controllerId,
                          instanceId: config.controller.instanceId,
                          emitStdout: config.knowledge.emitStdout,
                          storageMode: config.knowledge.storageMode,
                      })
                    : undefined,
            });
        this.patronStore = options.patronStore || new PatronStore(config.memory.dir);
        this.currencyLedger = this.patronStore.loadCurrency();
        this.standingLedger = this.patronStore.loadStanding();
        this.onionsPerStandingPoint = resolveOnionsPerStandingPoint(config);
        // Shared LettersStore: used by both PatronGateway (offer/sponsor/witness)
        // and the onPatronSupport callback (creditAttention via city API) so
        // tier-crossing letters from both paths land in the same inbox root and
        // the LettersStore's natural dedup works across both flows.
        this.lettersStore = new LettersStore(config.memory.dir);
        // EVENT-D1a: wire LettersStore rooted at memory.dir so every
        // tier-crossing offer/sponsor/witness/gift produces a Letter that
        // actually reaches disk. Prior to this wiring, PatronGateway was
        // constructed without a lettersStore and dispatchTierLetter
        // early-returned on every call — letters dropped on the floor.
        this.patronGateway =
            options.patronGateway ||
            new PatronGateway({
                currencyLedger: this.currencyLedger,
                standingLedger: this.standingLedger,
                runtimes: this.runtimes,
                soulsDir: config.souls.dir,
                lettersStore: this.lettersStore,
                memoryDir: config.memory.dir,
            });
        this.loreBus = options.loreBus || new LoreBus();
        this.factionStockpile = options.factionStockpile || new FactionStockpileLedger(config.memory.dir);
        // Shared per-host EconomyEventLog. CityIntegrationService is created
        // in src/controller/index.ts after the host; that call site passes
        // `host.getEconomyEventLog()` so AP/GP/NCRI emissions all land in one
        // append-only stream rooted at `config.memory.dir`.
        // TODO (S-HOST-WIRE follow-up): once ResidentRuntime owns an ApLedger
        // (currently it uses `state.attention` directly), the spawn path in
        // `startRuntime` should call `apLedger.attachEconomyEventLog(this.economyEventLog, { residentName: soul.frontmatter.name })`
        // so resident-side AP grant/decay/top-up/fade events feed the same log.
        this.economyEventLog = options.economyEventLog || new EconomyEventLog(config.memory.dir);
        this.cityIntegrationService = new CityIntegrationService({
            memoryRoot: config.memory.dir,
            getRuntime: resident => this.getRuntime(resident),
            inventory: {
                inspectResidentGold: resident => this.inspectResidentGold(resident),
                burnResidentGold: (resident, amount) => this.burnResidentGold(resident, amount),
            },
            birth: {
                birthResident: input => this.birthResidentFromCity(input),
            },
            economyEventLog: this.economyEventLog,
            // QA-20260601-065: wire patron standing + tier letters for city-API
            // support grants so the dashboard "Support with AP" button produces
            // the same standing/letter effects as the patron:offer CLI path.
            onPatronSupport: event => {
                // T0.0b: Shards-free settled-support seam. Keys on personId
                // (=== landing users.id) when the caller resolved it (the same
                // canonical id the ap_topup economy event records), else patronHandle,
                // else cityUserId. When personId is present, standing aligns with the
                // economy log. NOTE: not structurally enforced — if a grant arrives
                // without personId, standing keys on a fallback while the log still
                // records cityUserId; the upstream cityUserId->personId join is the
                // real guard against fragmentation.
                recordSettledSupport(
                    {
                        patronId: event.personId ?? event.patronHandle ?? event.cityUserId,
                        faction: event.faction,
                        residentName: event.residentName,
                        onionsSettled: event.amount,
                        ts: event.ts,
                        reason: event.note,
                    },
                    {
                        standingLedger: this.standingLedger,
                        lettersStore: this.lettersStore,
                        onionsPerStandingPoint: this.onionsPerStandingPoint,
                    },
                );
                this.persistPatronLedgers();
            },
        });
        this.bindGatewayEvents();
    }

    /**
     * Shared {@link EconomyEventLog} for this host. Pass to
     * {@link CityIntegrationService} so AP/GP/NCRI activity is recorded in
     * one append-only stream per `memoryRoot`. See packet S-HOST-WIRE.
     */
    public getEconomyEventLog(): EconomyEventLog {
        return this.economyEventLog;
    }

    public getCityIntegrationService(): CityIntegrationService {
        return this.cityIntegrationService;
    }

    async start(): Promise<void> {
        await this.gateway.connect();
        if (this.cityGateway && !this.cityGatewayIsShared) {
            await this.cityGateway.connect();
            await this.cityGateway.hello();
        }
        this.running = true;
        await this.handshakeAndReconcile();

        if (!this.options.once) {
            this.reconcileTimer = setInterval(() => this.reconcile().catch(error => this.handleError(error)), 10000);
        }
    }

    async stop(): Promise<void> {
        this.running = false;
        if (this.reconcileTimer) {
            clearInterval(this.reconcileTimer);
            this.reconcileTimer = undefined;
        }

        this.stopAllRuntimes('controller_stop');
        await this.drainInFlightPerceptions();
        await this.gameSkill.flush?.();
        // Persist patron balance and standing states on shutdown defensively
        try {
            this.persistPatronLedgers();
        } catch (error) {
            // eslint-disable-next-line no-console
            console.error('[controller-host] patron ledger persist failed during shutdown', error);
        }
        if (this.cityGateway && !this.cityGatewayIsShared) {
            this.cityGateway.close();
        }
        this.gateway.close();
    }

    public listResidents(): { name: string; state: RuntimeState }[] {
        const list: { name: string; state: RuntimeState }[] = [];
        for (const [name, runtime] of this.runtimes.entries()) {
            list.push({
                name,
                state: runtime.getState(),
            });
        }
        return list;
    }

    public getRuntime(name: string): ResidentRuntime | undefined {
        return this.runtimes.get(name);
    }

    public async birthResidentFromCity(input: BirthResidentRequest): Promise<{ resident: string; created: boolean; connected: boolean }> {
        writeBirthSoulFile(this.config.souls.dir, input);
        const soul = this.soulLoader.load(input.residentName);
        const residents = new Map((await this.gateway.listResidents('all')).map(resident => [resident.name, resident]));
        const existing = residents.get(input.residentName);
        let created = false;
        if (!existing) {
            await this.gateway.createResident({
                name: input.residentName,
                spawnPosition: input.spawnPosition || soul.frontmatter.spawnPosition,
                appearance: input.appearance,
                initialInventory: cityInitialInventory(input) || soul.frontmatter.initialInventory,
                initialEquipment: input.initialEquipment || soul.frontmatter.initialEquipment,
            });
            created = true;
        }
        if (!this.runtimes.has(input.residentName)) {
            await this.connectWithSoul(soul);
        }
        this.cityBorn.add(input.residentName);
        this.bornStore.add(input.residentName);
        this.desired.add(input.residentName);
        return { resident: input.residentName, created, connected: true };
    }

    public inspectResidentGold(name: string): Promise<{ resident: string; itemId: 995; amount: number }> {
        return this.withCityGateway(
            gateway => gateway.inspectResidentGold(name),
            error => isTransientCityGatewayError(error),
        );
    }

    public burnResidentGold(
        name: string,
        amount: number,
    ): Promise<{ resident: string; itemId: 995; burnedAmount: number; remainingAmount: number }> {
        return this.withCityGateway(
            gateway => gateway.burnResidentGold(name, amount),
            error => isGatewayNotOpenError(error),
        );
    }

    public enqueuePerceptionEvent(residentName: string, event: PerceptionEvent): boolean {
        const runtime = this.runtimes.get(this.runtimeName(residentName));
        if (!runtime) {
            return false;
        }
        runtime.onEvent(event);
        return true;
    }

    public persistPatronLedgers(): void {
        this.patronStore.saveCurrency(this.currencyLedger);
        this.patronStore.saveStanding(this.standingLedger);
    }

    public refreshPatronLedgersFromDisk(): void {
        this.currencyLedger.replaceWithSnapshot(this.patronStore.loadCurrency().snapshot());
        this.standingLedger.replaceWithSnapshot(this.patronStore.loadStanding().snapshot());
    }

    async reconcile(): Promise<void> {
        if (this.reconcileInFlight) {
            this.reconcileQueued = true;
            return this.reconcileInFlight;
        }

        this.reconcileInFlight = this.drainReconcileQueue();
        try {
            await this.reconcileInFlight;
        } finally {
            this.reconcileInFlight = undefined;
        }
    }

    private async drainReconcileQueue(): Promise<void> {
        do {
            this.reconcileQueued = false;
            await this.performReconcile();
        } while (this.reconcileQueued);
    }

    private async performReconcile(): Promise<void> {
        this.refreshDesiredResidents();
        const list = await this.gateway.listResidents('all');
        const residents = new Map(list.map(resident => [resident.name, resident]));

        for (const runtimeName of [...this.runtimes.keys()]) {
            if (!this.desired.has(runtimeName)) {
                this.stopRuntime(runtimeName, 'no_longer_desired');
            }
        }

        for (const name of this.desired) {
            // Isolate per-resident reconcile failures so one bad resident cannot
            // block the whole cohort. This matters especially for persisted
            // city-born residents: a born resident whose soul file is missing
            // would otherwise throw in createAndConnect and abort the entire
            // reconcile pass on every tick. Log + skip; the next pass retries.
            try {
                const summary = residents.get(name);
                if (!summary) {
                    await this.createAndConnect(name);
                } else if (!summary.online) {
                    this.stopRuntime(name, 'resident_offline');
                    await this.connect(name);
                } else if (!this.isControlledByThisController(summary)) {
                    this.stopRuntime(name, 'gateway_control_changed');
                    await this.connect(name);
                } else if (!this.runtimes.has(name)) {
                    this.stopRuntime(name, 'runtime_missing');
                    await this.attachExisting(name);
                }
            } catch (error) {
                // eslint-disable-next-line no-console
                console.error(`[controller-host] reconcile failed for resident ${name}; skipping this pass`, error);
            }
        }
    }

    private async createAndConnect(name: string): Promise<void> {
        const soul = this.soulLoader.load(name);
        await this.gateway.createResident({
            name,
            spawnPosition: soul.frontmatter.spawnPosition,
            initialInventory: soul.frontmatter.initialInventory,
            initialEquipment: soul.frontmatter.initialEquipment,
        });
        await this.connectWithSoul(soul);
    }

    private async connect(name: string): Promise<void> {
        await this.connectWithSoul(this.soulLoader.load(name));
    }

    private async attachExisting(name: string): Promise<void> {
        const soul = this.soulLoader.load(name);
        await this.gateway.attach({ name, observe: true, control: true, onDisconnect: 'idle' });
        this.startRuntime(soul);
    }

    private async connectWithSoul(soul: ReturnType<SoulLoader['load']>): Promise<void> {
        await this.gateway.connectResident({ name: soul.frontmatter.name, observe: true, control: true, onDisconnect: 'idle' });
        this.startRuntime(soul);
    }

    private startRuntime(soul: ReturnType<SoulLoader['load']>): void {
        const residentDir = this.memory.ensureResident(soul.frontmatter.name);
        void residentDir;
        if (this.runtimes.has(soul.frontmatter.name)) {
            return;
        }
        const thinkingWatchdogMs = configuredThinkingWatchdogMs(this.config);

        const runtimeOptions = {
            soul,
            gateway: this.gateway,
            memory: this.memory,
            stateStore: this.stateStore,
            llm: this.llm,
            actionLog: this.actionLog,
            inferenceLog: this.inferenceLog,
            gameSkill: this.gameSkill,
            planStore: this.planStore,
            sparkModules: this.sparkModules,
            evidence: this.tryCreateRuntimeEvidence(soul),
            patrons: this.config.patrons,
            patronGateway: this.patronGateway,
            cityExchange: this.cityIntegrationService,
            loreBus: this.loreBus,
            factionStockpile: this.factionStockpile,
            watchdog: thinkingWatchdogMs === undefined ? undefined : { thinkingMs: thinkingWatchdogMs },
            onDeath: (name: string, cause: string) => this.handleResidentDeath(name, cause),
        };
        this.runtimes.set(
            soul.frontmatter.name,
            this.options.runtimeFactory ? this.options.runtimeFactory(runtimeOptions) : new ResidentRuntime(runtimeOptions),
        );
    }

    private createRuntimeEvidence(soul: ReturnType<SoulLoader['load']>): ResidentRuntimeEvidence {
        const store = new EvidenceStore(soul.frontmatter.name, this.config.memory.dir);
        const residentId = residentSlug(soul.frontmatter.name);
        const sessionId = `${this.config.controller.instanceId}-${residentId}-${Date.now()}`;
        const session = store.beginSession(sessionId, soul.sourcePath || 'unknown-soul');
        return {
            store,
            sessionId: session.sessionId,
            trajectory: new TrajectoryBuilder(store),
            library: new LibraryUpdater(soul.frontmatter.name, this.config.memory.dir, {
                factionId: soul.frontmatter.factionId,
            }),
        };
    }

    /**
     * Wraps createRuntimeEvidence so an evidence-layer failure (disk full,
     * permission denied, corrupt index.json) does not block the resident from
     * starting. Per spec: "evidence loss is preferred over agent loss." On
     * failure the resident runs without an evidence sink; ResidentRuntime is
     * defensive about an undefined `evidence` field.
     */
    private tryCreateRuntimeEvidence(soul: ReturnType<SoulLoader['load']>): ResidentRuntimeEvidence | undefined {
        try {
            return this.createRuntimeEvidence(soul);
        } catch (error) {
            // eslint-disable-next-line no-console
            console.error(
                `[controller-host] evidence init failed for resident ${soul.frontmatter.name}; resident will start without evidence sink`,
                error,
            );
            return undefined;
        }
    }

    private bindGatewayEvents(): void {
        this.gateway.on('ready', () => {
            if (this.running) {
                this.handshakeAndReconcile().catch(error => this.handleError(error));
            }
        });
        this.gateway.on('perception', (residentId, perception) => {
            const runtime = this.runtimes.get(this.runtimeName(residentId));
            if (!runtime) {
                return;
            }
            const task = runtime.onPerception(perception).catch(error => this.handleError(error));
            this.inFlightPerceptions.add(task);
            task.finally(() => this.inFlightPerceptions.delete(task));
        });
        this.gateway.on('event', (residentId, event) => {
            this.runtimes.get(this.runtimeName(residentId))?.onEvent(event);
        });
        this.gateway.on('residentPaused', (name, cause) => {
            this.pauseResident(name, cause || 'gateway_pause');
        });
        this.gateway.on('disconnect', () => {
            this.stopAllRuntimes('gateway_disconnect');
        });
        this.gateway.on('error', error => this.handleError(error));
    }

    private async handshakeAndReconcile(): Promise<void> {
        if (this.lifecycleInFlight) {
            return this.lifecycleInFlight;
        }

        this.lifecycleInFlight = (async () => {
            await this.gateway.hello();
            await this.reconcile();
        })();
        try {
            await this.lifecycleInFlight;
        } finally {
            this.lifecycleInFlight = undefined;
        }
    }

    private isControlledByThisController(summary: { controllerId?: string; controllingClientId?: string }): boolean {
        const owner = summary.controllerId || summary.controllingClientId;
        return owner === this.config.gateway.controllerId;
    }

    private runtimeName(residentId: string): string {
        return residentId.startsWith('resident:') ? residentId.slice('resident:'.length) : residentId;
    }

    private stopAllRuntimes(cause: string): void {
        for (const name of [...this.runtimes.keys()]) {
            this.stopRuntime(name, cause);
        }
    }

    private pauseResident(name: string, cause: string): void {
        this.paused.add(name);
        this.desired.delete(name);
        this.stopRuntime(name, cause);
    }

    /**
     * Invoked once when a managed resident is first observed deceased. For a
     * city-born resident, prune it from the desired set + persisted manifest so
     * the reconcile loop does not reconnect it (and its respawnPolicy un-die
     * it) — a Soul whose attention ran out must stay dead and reach the
     * graveyard. Authored cohort residents (config.residents) are left untouched
     * and keep their existing respawn behavior.
     */
    private handleResidentDeath(name: string, cause: string): void {
        if (!this.cityBorn.has(name)) {
            return;
        }
        this.cityBorn.delete(name);
        this.desired.delete(name);
        this.bornStore.remove(name);
        // eslint-disable-next-line no-console
        console.log(`[controller-host] city-born resident ${name} died (${cause}); pruned from cohort — death stays in the graveyard.`);
    }

    private refreshDesiredResidents(): void {
        this.desired.clear();
        const discovered = this.config.souls.discoverResidents ? this.discoveredSoulResidents() : [];
        for (const name of [...this.configuredDesired, ...discovered, ...this.cityBorn]) {
            if (!this.paused.has(name)) {
                this.desired.add(name);
            }
        }
    }

    private discoveredSoulResidents(): string[] {
        const loader = this.soulLoader as Partial<Pick<SoulLoader, 'listResidentNames'>>;
        return typeof loader.listResidentNames === 'function' ? loader.listResidentNames() : [];
    }

    private stopRuntime(name: string, cause: string): void {
        const runtime = this.runtimes.get(name);
        if (!runtime) {
            return;
        }

        runtime.stop(cause);
        this.runtimes.delete(name);
    }

    private async drainInFlightPerceptions(): Promise<void> {
        while (this.inFlightPerceptions.size > 0) {
            await Promise.allSettled([...this.inFlightPerceptions]);
        }
    }

    private async withCityGateway<T>(
        operation: (gateway: CityInventoryGateway) => Promise<T>,
        shouldRetryOperationError: (error: unknown) => boolean,
    ): Promise<T> {
        if (this.cityGateway) {
            return operation(this.cityGateway);
        }

        if (!this.cityGatewayFactory) {
            throw new Error('City inventory gateway is not configured');
        }

        let lastError: unknown;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
            const gateway = this.cityGatewayFactory();
            let stage: 'connect' | 'hello' | 'operation' = 'connect';
            try {
                await gateway.connect();
                stage = 'hello';
                await gateway.hello();
                stage = 'operation';
                return await operation(gateway);
            } catch (error) {
                lastError = error;
                const retrySafe = stage !== 'operation' || shouldRetryOperationError(error);
                if (attempt >= 3 || !retrySafe) {
                    throw error;
                }
                await delay(150 * attempt);
            } finally {
                gateway.close();
            }
        }
        throw lastError instanceof Error ? lastError : new Error(String(lastError));
    }

    private handleError(error: unknown): void {
        const message = error instanceof Error ? error.stack || error.message : String(error);
        process.stderr.write(`[controller] ${message}\n`);
    }
}

function isTransientCityGatewayError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /Gateway socket is not open|Gateway socket closed|ECONNRESET|timed out/i.test(message);
}

function isGatewayNotOpenError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /Gateway socket is not open/i.test(message);
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Resolve the onions->standing-point scale for the settled-support seam.
 *
 * Reads `config.economy.onionsPerStandingPoint` when set to a positive number.
 * Otherwise falls back to the KNOWN-PLACEHOLDER 1:1 scale and warns LOUDLY — so
 * the broken 1:1 economy (standing tiers are 10/30/75; a 500-onion check-in
 * would instantly mint Officer) is never silently shipped. Product must set the
 * real value before the real onion-spend path goes live.
 */
function resolveOnionsPerStandingPoint(config: ControllerConfig): number {
    const configured = config.economy?.onionsPerStandingPoint;
    if (typeof configured === 'number' && Number.isFinite(configured) && configured > 0) {
        return configured;
    }
    // Env fallback so the live run can set the real scale without a config change
    // (e.g. CITY_ONIONS_PER_STANDING_POINT=100). Product decision; James chose ≥100.
    const fromEnv = Number(process.env.CITY_ONIONS_PER_STANDING_POINT);
    if (Number.isFinite(fromEnv) && fromEnv > 0) {
        return fromEnv;
    }
    // eslint-disable-next-line no-console
    console.warn(
        '[controller-host] onionsPerStandingPoint is using the PLACEHOLDER 1:1 scale. ' +
            'Standing accrues 1 point per onion (tiers 10/30/75), so a single large grant can instantly top-tier a patron. ' +
            'Set config.economy.onionsPerStandingPoint to the real scale before enabling real onion spend.',
    );
    return 1;
}
