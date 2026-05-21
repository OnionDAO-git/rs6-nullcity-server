export function isLoopbackPeerAddress(address: string): boolean {
    const normalized = address.replace(/^::ffff:/, '');
    return normalized === '127.0.0.1' || normalized === '::1';
}
