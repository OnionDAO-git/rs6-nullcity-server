import EventEmitter from 'events';
import type { AddressInfo, Socket } from 'net';

class NullSocketCore extends EventEmitter {
    public destroyed = false;

    public address(): AddressInfo {
        return {
            address: '127.0.0.1',
            family: 'IPv4',
            port: 0,
        };
    }

    public destroy(): this {
        this.destroyed = true;
        this.emit('close');
        return this;
    }

    public write(): boolean {
        return true;
    }
}

export const createNullSocket = (): Socket => {
    const socket = new NullSocketCore();
    return new Proxy(socket, {
        get(target, property, receiver) {
            if (property === Symbol.toStringTag) {
                return 'NullSocket';
            }
            if (property in target) {
                return Reflect.get(target, property, receiver);
            }

            throw new Error(`NullSocket does not implement socket property "${String(property)}".`);
        },
    }) as unknown as Socket;
};

export type NullSocket = Socket;
