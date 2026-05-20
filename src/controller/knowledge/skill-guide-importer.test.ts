import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadSkillGuideKnowledgeEntries } from './skill-guide-importer';

describe('skill guide importer', () => {
    it('turns local skill guide JSON into compact knowledge entries', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-guides-'));
        fs.writeFileSync(
            path.join(root, 'firemaking.json'),
            JSON.stringify({
                id: 132,
                name: 'Firemaking',
                members: false,
                sub_guides: [
                    {
                        name: 'Burning',
                        lines: [
                            { item: 'rs:logs', text: 'Normal logs', level: 1 },
                            { item: 'rs:oak_logs', text: 'Oak logs', level: 15 },
                        ],
                    },
                ],
            }),
        );

        const entries = loadSkillGuideKnowledgeEntries(root);

        expect(entries).toEqual([
            expect.objectContaining({
                id: 'skill-guide:firemaking',
                title: 'Skill Guide: Firemaking',
                topics: expect.arrayContaining(['firemaking', 'skill-guide']),
                keywords: expect.arrayContaining(['firemaking', 'normal', 'logs', 'oak']),
                source: path.join(root, 'firemaking.json'),
                summary: expect.stringContaining('level 1 Normal logs (rs:logs)'),
            }),
        ]);
    });

    it('bounds imported guide size and skips invalid files', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-guides-'));
        fs.writeFileSync(
            path.join(root, 'woodcutting.json'),
            JSON.stringify({
                id: 139,
                name: 'Woodcutting',
                sub_guides: [
                    {
                        name: 'Trees',
                        lines: [
                            { item: 'rs:logs', text: 'Normal trees', level: 1 },
                            { item: 'rs:oak_logs', text: 'Oak trees', level: 15 },
                            { item: 'rs:willow_logs', text: 'Willow trees', level: 30 },
                        ],
                    },
                ],
            }),
        );
        fs.writeFileSync(path.join(root, 'broken.json'), '{nope');

        const entries = loadSkillGuideKnowledgeEntries(root, { maxLinesPerGuide: 1 });

        expect(entries).toHaveLength(1);
        expect(entries[0].summary).toContain('level 1 Normal trees');
        expect(entries[0].summary).not.toContain('Oak trees');
    });
});
