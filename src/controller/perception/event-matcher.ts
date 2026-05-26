/**
 * Compares actual and expected event kinds, supporting aliases for combat events
 * to resolve mismatches between engine-emitted kinds and rule-expected kinds.
 */
export function matchEventKind(actual: string, expected: string): boolean {
    const act = actual.toLowerCase();
    const exp = expected.toLowerCase();

    if (act === exp) {
        return true;
    }

    // Aliases for taking combat damage / hits
    const hitAliases = ['hit', 'hit_taken', 'hit_received', 'attacked'];
    if (hitAliases.includes(act) && hitAliases.includes(exp)) {
        return true;
    }

    // Aliases for resident/actor death
    const deathAliases = ['death', 'died'];
    if (deathAliases.includes(act) && deathAliases.includes(exp)) {
        return true;
    }

    return false;
}
