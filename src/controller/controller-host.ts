import { ControllerConfig } from './config';
import { EvidenceStore, LibraryUpdater, TrajectoryBuilder } from './evidence';
import { createDefaultGameSkillEntries } from './knowledge/game-skill-entries';
import { GameSkillService } from './knowledge/game-skill-context';
import { KnowledgeSuggestionStore } from './knowledge/suggestions';
import { LlmClient } from './llm/llm-client';
import { ActionLog } from './logging/action-log';
import { InferenceLog } from './logging/inference-log';
import { MemoryStore } from './memory/memory-store';
import { residentSlug, RuntimeStateStore, type RuntimeState } from './memory/runtime-state';
import { ResidentRuntime, type ResidentRuntimeEvidence, type ResidentRuntimeGameSkill } from './resident-runtime';
import { SoulLoader } from './soul/soul-loader';
import { standardSparkModules, type SparkModule } from './spark';
import { GatewayClient } from './transport/gateway-client';
import { PatronStore } from './patron/patron-store';
import { PatronGateway } from './patron/patron-gateway';
import { CurrencyLedger } from './patron/currency-ledger';
import { StandingLedger } from './patron/standing-ledger';
import { LettersStore } from './patron/letters-store';

export interface ControllerHostOptions {
    once?: boolean;
    logEnvelope?: boolean;
    gateway?: GatewayClient;
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
}

export class ControllerHost {
    private readonly gateway: GatewayClient;
    private readonly runtimes = new Map<string, ResidentRuntime>();
    private readonly configuredDesired: Set<string>;
    private readonly desired: Set<string>;
    private readonly paused = new Set<string>();
    private readonly soulLoader: SoulLoader;
    private readonly memory: MemoryStore;
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

    constructor(
        private readonly config: ControllerConfig,
        private readonly options: ControllerHostOptions = {},
    ) {
        this.gateway =
            options.gateway ||
            new GatewayClient({
                url: config.gateway.url,
                authToken: config.gateway.authToken,
                controllerId: config.gateway.controllerId,
                reconnect: !options.once,
            });
        this.configuredDesired = new Set(config.residents);
        this.desired = new Set(config.residents);
        this.soulLoader = options.soulLoader || new SoulLoader(config.souls.dir);
        this.memory = options.memory || new MemoryStore(config.memory.dir, config.memory.qmdBin);
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
                lettersStore: new LettersStore(config.memory.dir),
            });
        this.bindGatewayEvents();
    }

    async start(): Promise<void> {
        await this.gateway.connect();
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
            this.patronStore.saveCurrency(this.currencyLedger);
            this.patronStore.saveStanding(this.standingLedger);
        } catch (error) {
            // eslint-disable-next-line no-console
            console.error('[controller-host] patron ledger persist failed during shutdown', error);
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

        const runtimeOptions = {
            soul,
            gateway: this.gateway,
            memory: this.memory,
            stateStore: this.stateStore,
            llm: this.llm,
            actionLog: this.actionLog,
            inferenceLog: this.inferenceLog,
            gameSkill: this.gameSkill,
            sparkModules: this.sparkModules,
            evidence: this.tryCreateRuntimeEvidence(soul),
            patrons: this.config.patrons,
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
            library: new LibraryUpdater(soul.frontmatter.name, this.config.memory.dir),
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

    private refreshDesiredResidents(): void {
        this.desired.clear();
        const discovered = this.discoveredSoulResidents();
        for (const name of [...this.configuredDesired, ...discovered]) {
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

    private handleError(error: unknown): void {
        const message = error instanceof Error ? error.stack || error.message : String(error);
        process.stderr.write(`[controller] ${message}\n`);
    }
}
