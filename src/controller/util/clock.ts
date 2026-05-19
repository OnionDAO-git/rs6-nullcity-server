export interface Clock {
    now(): Date;
    setTimeout(callback: () => void, ms: number): NodeJS.Timeout;
    clearTimeout(timeout: NodeJS.Timeout): void;
}

export const systemClock: Clock = {
    now: () => new Date(),
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: timeout => clearTimeout(timeout),
};

export function isoDate(date: Date = new Date()): string {
    return date.toISOString().slice(0, 10);
}
