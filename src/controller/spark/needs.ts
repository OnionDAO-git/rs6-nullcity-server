export interface NeedState {
    id: string;
    score: number;
    cause?: string;
}

export function attentionNeed(attention: number): NeedState {
    return {
        id: 'attention',
        score: attention,
        cause: attention <= 0 ? 'attention_exhausted' : undefined,
    };
}
