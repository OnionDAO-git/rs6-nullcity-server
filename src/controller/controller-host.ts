import { ControllerConfig } from './config';
import { LlmClient } from './llm/llm-client';
import { ActionLog } from './logging/action-log';
import { InferenceLog } from './logging/inference-log';
import { MemoryStore } from './memory/memory-store';
import { RuntimeStateStore } from './memory/runtime-state';
import { ResidentRuntime } from './resident-runtime';
import { SoulLoader } from './soul/soul-loader';
import { GatewayClient } from './transport/gateway-client';

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
}

export class ControllerHost {
    private readonly gateway: GatewayClient;
    private readonly runtimes = new Map<string, ResidentRuntime>();
    private readonly desired: Set<string>;
    private readonly soulLoader: SoulLoader;
    private readonly memory: MemoryStore;
    private readonly stateStore: RuntimeStateStore;
    private readonly llm: LlmClient;
    private readonly actionLog: ActionLog;
    private readonly inferenceLog: InferenceLog;
    private reconcileTimer?: NodeJS.Timeout;
    private running = false;
    private lifecycleInFlight?: Promise<void>;
    private reconcileInFlight?: Promise<void>;
    private reconcileQueued = false;

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
        this.desired = new Set(config.residents);
        this.soulLoader = options.soulLoader || new SoulLoader(config.souls.dir);
        this.memory = options.memory || new MemoryStore(config.memory.dir, config.memory.qmdBin);
        this.stateStore = options.stateStore || new RuntimeStateStore(config.memory.dir);
        this.llm = options.llm || new LlmClient(config.llm.endpoints, config.inference.maxConcurrent);
        this.actionLog = options.actionLog || new ActionLog(config.logging.dir);
        this.inferenceLog = options.inferenceLog || new InferenceLog(config.logging.dir, Boolean(options.logEnvelope));
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
        this.gateway.close();
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

        this.runtimes.set(
            soul.frontmatter.name,
            new ResidentRuntime({
                soul,
                gateway: this.gateway,
                memory: this.memory,
                stateStore: this.stateStore,
                llm: this.llm,
                actionLog: this.actionLog,
                inferenceLog: this.inferenceLog,
            }),
        );
    }

    private bindGatewayEvents(): void {
        this.gateway.on('ready', () => {
            if (this.running) {
                this.handshakeAndReconcile().catch(error => this.handleError(error));
            }
        });
        this.gateway.on('perception', (residentId, perception) => {
            this.runtimes
                .get(this.runtimeName(residentId))
                ?.onPerception(perception)
                .catch(error => this.handleError(error));
        });
        this.gateway.on('event', (residentId, event) => {
            this.runtimes.get(this.runtimeName(residentId))?.onEvent(event);
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

    private stopRuntime(name: string, cause: string): void {
        const runtime = this.runtimes.get(name);
        if (!runtime) {
            return;
        }

        runtime.stop(cause);
        this.runtimes.delete(name);
    }

    private handleError(error: unknown): void {
        const message = error instanceof Error ? error.stack || error.message : String(error);
        process.stderr.write(`[controller] ${message}\n`);
    }
}
