export class Backoff {
    private attempt = 0;

    constructor(
        private readonly minMs = 250,
        private readonly maxMs = 8000,
    ) {}

    nextDelayMs(): number {
        const delay = Math.min(this.maxMs, this.minMs * 2 ** this.attempt);
        this.attempt += 1;
        return delay + Math.floor(Math.random() * this.minMs);
    }

    reset(): void {
        this.attempt = 0;
    }
}
