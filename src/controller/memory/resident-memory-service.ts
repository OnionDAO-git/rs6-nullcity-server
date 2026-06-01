import { readRecentLibraryMemories, readRecentPatronMemories } from '../evidence/library-memories';
import {
    FactsStore,
    type FactMemorySnippet,
    type FactMemoryTopic,
    type ReadTopicInput,
    type RelevantMemoryInput,
    type RememberFactInput,
} from './facts-store';

const defaultRelevantFactLimit = 6;
const defaultLibraryLimit = 4;
const defaultPatronLimit = 6;

export interface ResidentMemoryServiceOptions {
    memoryRoot: string;
    now?: () => string;
}

export type ResidentMemorySnippet =
    | FactMemorySnippet
    | {
          source: 'library' | 'patron';
          resident: string;
          topic: 'timeline' | 'patrons';
          path: string;
          text: string;
          score: number;
      };

export class ResidentMemoryService {
    private readonly facts: FactsStore;

    constructor(private readonly options: ResidentMemoryServiceOptions) {
        this.facts = new FactsStore(options.memoryRoot, options.now);
    }

    rememberFact(input: RememberFactInput): FactMemorySnippet {
        return this.facts.rememberFact(input);
    }

    readTopic(input: ReadTopicInput): FactMemoryTopic {
        return this.facts.readTopic(input);
    }

    relevantTo(input: RelevantMemoryInput): ResidentMemorySnippet[] {
        const facts = this.facts.relevantTo({
            ...input,
            limit: input.limit ?? defaultRelevantFactLimit,
        });
        const patron = readRecentPatronMemories(this.options.memoryRoot, input.resident, defaultPatronLimit).map(text => ({
            source: 'patron' as const,
            resident: input.resident,
            topic: 'patrons' as const,
            path: 'library/timeline.jsonl',
            text,
            score: 1,
        }));
        const library = readRecentLibraryMemories(this.options.memoryRoot, input.resident, defaultLibraryLimit).map(text => ({
            source: 'library' as const,
            resident: input.resident,
            topic: 'timeline' as const,
            path: 'library/timeline.jsonl',
            text,
            score: 1,
        }));
        return [...facts, ...patron, ...library];
    }

    searchSemantic(_input: RelevantMemoryInput): ResidentMemorySnippet[] {
        return [];
    }
}
