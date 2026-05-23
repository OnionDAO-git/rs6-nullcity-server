export interface PatronConfig {
    handle: string;
    kind: 'patron_gift' | 'patron_witness' | 'patron_sponsor';
}

export class PatronRegistry {
    private readonly patrons = new Map<string, 'patron_gift' | 'patron_witness' | 'patron_sponsor'>();

    constructor(configs: PatronConfig[] = []) {
        for (const config of configs) {
            this.patrons.set(config.handle.toLowerCase(), config.kind);
        }
    }

    getKind(handle: string): 'patron_gift' | 'patron_witness' | 'patron_sponsor' | undefined {
        return this.patrons.get(handle.toLowerCase());
    }

    isPatron(handle: string): boolean {
        return this.patrons.has(handle.toLowerCase());
    }
}
