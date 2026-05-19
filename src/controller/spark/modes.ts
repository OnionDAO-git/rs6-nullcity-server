export type SparkMode = 'idle' | 'executing' | 'deciding';

export interface SparkModeState {
    mode: SparkMode;
    changedAt: Date;
    cause?: string;
}

export function idleMode(cause?: string): SparkModeState {
    return { mode: 'idle', changedAt: new Date(), cause };
}
