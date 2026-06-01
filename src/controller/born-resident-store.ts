import fs from 'fs';
import path from 'path';

interface BornResidentFile {
    schemaVersion: 1;
    residents: string[];
}

/**
 * Persists the set of city-born resident names (humans funded a Soul proposal
 * and birthed it) so they survive a controller restart.
 *
 * The in-memory `cityBorn` set on ControllerHost alone would orphan born
 * residents on restart: they are in neither `config.residents` nor soul
 * discovery, so `refreshDesiredResidents()` would drop them and the reconcile
 * loop would stop their runtimes. Per the maintainer's invariant — a
 * human-spawned resident must never be erased — ControllerHost loads this
 * manifest on construction and appends to it on birth.
 *
 * This is deliberately distinct from `souls.discoverResidents`: discovery would
 * pull in every soul file in the souls dir (including authored/test souls),
 * whereas this manifest contains only genuinely human-birthed residents.
 */
export class BornResidentStore {
    private readonly filePath: string;

    constructor(private readonly memoryRoot: string) {
        this.filePath = path.join(memoryRoot, 'born-residents.json');
    }

    list(): string[] {
        try {
            const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as Partial<BornResidentFile>;
            if (!Array.isArray(parsed.residents)) {
                return [];
            }
            return parsed.residents.filter((name): name is string => typeof name === 'string');
        } catch {
            // Missing or corrupt manifest must not block startup — born
            // residents are recoverable from save files; an empty list is safe.
            return [];
        }
    }

    add(name: string): void {
        const residents = new Set(this.list());
        if (residents.has(name)) {
            return;
        }
        residents.add(name);
        this.persist([...residents]);
    }

    /**
     * Drop a born resident from the manifest so it is not re-spawned on the next
     * restart. Intended for retirement/permanent death — a dead resident belongs
     * in the Library of Souls, not back in the live cohort.
     *
     * TODO (FIX-BORN-PERSIST-RESTART-1 follow-up): wire this into the death /
     * retirement path so a born resident that dies is pruned here. Until then a
     * born resident that dies could be re-spawned on a controller restart.
     */
    remove(name: string): void {
        const residents = new Set(this.list());
        if (!residents.delete(name)) {
            return;
        }
        this.persist([...residents]);
    }

    private persist(residents: string[]): void {
        fs.mkdirSync(this.memoryRoot, { recursive: true });
        const payload: BornResidentFile = { schemaVersion: 1, residents };
        const tmp = `${this.filePath}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
        fs.renameSync(tmp, this.filePath);
    }
}
