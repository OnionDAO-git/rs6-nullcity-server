export function estimateTokens(value: unknown): number {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    if (!text) {
        return 0;
    }

    return Math.ceil(text.length / 4);
}
