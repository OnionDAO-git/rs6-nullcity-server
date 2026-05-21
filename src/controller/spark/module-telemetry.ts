import type { SparkModuleIdentity } from './modules';

export type SparkModuleTelemetryKind = 'debug' | 'decision' | 'observation' | 'metric' | 'warning' | 'error';

export interface SparkModuleTelemetryEvent {
    kind: SparkModuleTelemetryKind;
    message?: string;
    data?: Record<string, unknown>;
}

export interface SparkModuleTelemetryLogEntry {
    cause: 'module_telemetry';
    resident: string;
    sparkModule: SparkModuleIdentity;
    telemetry: SparkModuleTelemetryEvent;
}

export interface SparkModuleTelemetry {
    emit(event: SparkModuleTelemetryEvent): void;
}

export interface SparkModuleTelemetryOptions {
    resident: string;
    module: SparkModuleIdentity;
    append?: (entry: SparkModuleTelemetryLogEntry) => void;
    maxBytes?: number;
    maxTextLength?: number;
}

const DEFAULT_MAX_BYTES = 4096;
const DEFAULT_MAX_TEXT_LENGTH = 240;
const ALLOWED_KINDS = new Set<SparkModuleTelemetryKind>(['debug', 'decision', 'observation', 'metric', 'warning', 'error']);
const SECRET_KEY_PATTERN = /(api[_-]?key|token|secret|password|credential|auth)/i;
const SECRET_TEXT_PATTERN = /\b(?:sk-[A-Za-z0-9_-]{8,}|sk-or-v1-[A-Za-z0-9_-]+|[A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD)=[^\s,;]+)/gi;

export function createSparkModuleTelemetry(options: SparkModuleTelemetryOptions): SparkModuleTelemetry {
    return {
        emit(event) {
            const telemetry = sanitizeTelemetryEvent(event, {
                maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
                maxTextLength: options.maxTextLength ?? DEFAULT_MAX_TEXT_LENGTH,
            });
            options.append?.({
                cause: 'module_telemetry',
                resident: options.resident,
                sparkModule: options.module,
                telemetry,
            });
        },
    };
}

export const noopSparkModuleTelemetry: SparkModuleTelemetry = {
    emit: () => undefined,
};

function sanitizeTelemetryEvent(
    event: SparkModuleTelemetryEvent,
    limits: { maxBytes: number; maxTextLength: number },
): SparkModuleTelemetryEvent {
    if (!ALLOWED_KINDS.has(event.kind)) {
        throw new Error(`SPARK module telemetry kind ${String(event.kind)} is not allowed`);
    }

    const telemetry: SparkModuleTelemetryEvent = {
        kind: event.kind,
        message: event.message === undefined ? undefined : redactText(event.message, limits.maxTextLength),
        data: event.data === undefined ? undefined : (redactValue(event.data, 'data', limits.maxTextLength) as Record<string, unknown>),
    };
    const bytes = JSON.stringify(telemetry).length;
    if (bytes > limits.maxBytes) {
        throw new Error(`SPARK module telemetry exceeds ${limits.maxBytes} bytes`);
    }
    return telemetry;
}

function redactValue(value: unknown, path: string, maxTextLength: number): unknown {
    if (typeof value === 'string') {
        return redactText(value, maxTextLength);
    }
    if (Array.isArray(value)) {
        return value.map((item, index) => redactValue(item, `${path}.${index}`, maxTextLength));
    }
    if (isRecord(value)) {
        return Object.fromEntries(
            Object.entries(value).map(([key, child]) => {
                const childPath = `${path}.${key}`;
                if (SECRET_KEY_PATTERN.test(key)) {
                    throw new Error(`SPARK module telemetry ${childPath} is not allowed to contain secret-like fields`);
                }
                return [key, redactValue(child, childPath, maxTextLength)];
            }),
        );
    }
    return value;
}

function redactText(text: string, maxTextLength: number): string {
    const redacted = text.replace(SECRET_TEXT_PATTERN, '[redacted]');
    return redacted.length > maxTextLength ? redacted.slice(0, maxTextLength).trimEnd() : redacted;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
