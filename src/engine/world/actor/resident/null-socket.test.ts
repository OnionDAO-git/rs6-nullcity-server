import _ from 'lodash';
import { createNullSocket } from './null-socket';

describe('createNullSocket', () => {
    it('supports Symbol.toStringTag lookups used by lodash cloneDeep during resident dialogues', () => {
        const socket = createNullSocket();

        expect(() => _.cloneDeep({ socket })).not.toThrow();
        expect(Object.prototype.toString.call(socket)).toBe('[object NullSocket]');
    });
});
