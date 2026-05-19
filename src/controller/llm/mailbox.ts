export interface InflightRequest {
    id: string;
    controller: AbortController;
    startedAt: Date;
    abortReason?: string;
}

export interface CompletedRequest<T = unknown> {
    id: string;
    value?: T;
    error?: unknown;
    discarded: boolean;
}

export class Mailbox {
    private inflight?: InflightRequest;
    private readonly completed = new Map<string, CompletedRequest>();

    start(id: string): InflightRequest {
        this.abort(`replaced_by:${id}`);
        this.inflight = {
            id,
            controller: new AbortController(),
            startedAt: new Date(),
        };
        return this.inflight;
    }

    current(): InflightRequest | undefined {
        return this.inflight;
    }

    finish<T>(id: string, value?: T, error?: unknown): CompletedRequest<T> {
        const discarded = this.inflight?.id !== id;
        const completed: CompletedRequest<T> = { id, value, error, discarded };
        if (this.inflight?.id === id) {
            this.inflight = undefined;
        }
        this.completed.set(id, completed);
        return completed;
    }

    drain<T>(id: string): CompletedRequest<T> | undefined {
        const completed = this.completed.get(id) as CompletedRequest<T> | undefined;
        if (completed) {
            this.completed.delete(id);
        }
        return completed;
    }

    abort(reason: string): void {
        if (!this.inflight) {
            return;
        }

        this.inflight.abortReason = reason;
        this.inflight.controller.abort(reason);
        this.inflight = undefined;
    }
}
