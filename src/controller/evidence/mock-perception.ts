import type { Perception } from '../transport/message-codecs';

export class MockPerceptionAdapter {
    private readonly queue: Perception[] = [];

    push(perception: Perception): void {
        this.queue.push(perception);
    }

    drain(): Perception[] {
        return this.queue.splice(0);
    }
}
