#!/usr/bin/env node

const { execFileSync } = require('node:child_process');
const path = require('node:path');

const uiExtensions = new Set(['.html', '.css', '.svelte', '.jsx', '.tsx']);
const uiPathPatterns = [/^public\//, /^src\/.*\/public\//, /^packages\/.*\/public\//, /^packages\/.*\/web\//];

function trackedFiles() {
    const output = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' });
    return output.split('\0').filter(Boolean);
}

const offenders = trackedFiles().filter(file => {
    const normalized = file.replace(/\\/g, '/');
    if (uiPathPatterns.some(pattern => pattern.test(normalized))) return true;
    return uiExtensions.has(path.extname(normalized));
});

if (offenders.length > 0) {
    console.error('Server UI boundary violation.');
    console.error('');
    console.error('rs6-nullcity-server owns runtime, controller, data, and JSON/control APIs only.');
    console.error('Move human-facing UI files to ../rs6-nullcity-residents-dashboard.');
    console.error('');
    console.error('Offending tracked files:');
    for (const offender of offenders) console.error(`- ${offender}`);
    process.exit(1);
}

console.log('Server UI boundary clean: no tracked UI files found.');
