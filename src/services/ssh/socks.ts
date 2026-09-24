import type { Socket } from 'node:net';
import type { ClientChannel } from 'ssh2';

// RFC 1928 CONNECT subset. Domain names are passed to SSH without local DNS.
export function serveSocks(socket: Socket, options: {
  allowedHosts?: string[]; allowedPorts?: number[];
  open(host: string, port: number, callback: (error: Error | undefined, channel?: ClientChannel) => void): void;
  ready(channel: ClientChannel): void;
}) {
  let buffer = Buffer.alloc(0), phase: 'greeting'|'request'|'connecting'|'done' = 'greeting';
  const timer = setTimeout(() => socket.destroy(), 15000);
  const detach = () => { clearTimeout(timer); socket.removeListener('data', read); socket.removeListener('end', ended); };
  socket.once('close', detach);
  const reply = (code: number) => Buffer.from([5, code, 0, 1, 0, 0, 0, 0, 0, 0]);
  function fail(code: number) { phase = 'done'; detach(); socket.end(reply(code), () => socket.destroy()); }
  function ended() { if (phase === 'greeting' || phase === 'request') socket.destroy(); }
  function read(chunk: Buffer) {
    if (phase === 'done' || phase === 'connecting') return;
    if (buffer.length + chunk.length > 65536) { fail(1); return; }
    buffer = Buffer.concat([buffer, chunk]);
    if (phase === 'greeting') {
      if (buffer.length < 2) return;
      if (buffer[0] !== 5 || buffer[1] === 0) { socket.destroy(); return; }
      const length = 2 + buffer[1];
      if (buffer.length < length) return;
      if (!buffer.subarray(2, length).includes(0)) {
        phase = 'done'; detach(); socket.end(Buffer.from([5, 255]), () => socket.destroy()); return;
      }
      socket.write(Buffer.from([5, 0])); buffer = buffer.subarray(length); phase = 'request';
    }
    if (buffer.length < 4) return;
    if (buffer[0] !== 5 || buffer[2] !== 0) { fail(1); return; }
    if (buffer[1] !== 1) { fail(7); return; }
    const type = buffer[3];
    if (![1, 3, 4].includes(type)) { fail(8); return; }
    if (type === 3 && buffer.length < 5) return;
    const addressLength = type === 1 ? 4 : type === 4 ? 16 : buffer[4];
    const offset = type === 3 ? 5 : 4, length = offset + addressLength + 2;
    if (buffer.length < length) return;
    const address = buffer.subarray(offset, offset + addressLength);
    let host: string;
    if (type === 1) host = [...address].join('.');
    else if (type === 4) host = Array.from({ length: 8 }, (_, i) => address.readUInt16BE(i * 2).toString(16)).join(':');
    else {
      host = address.toString('latin1');
      if (!/^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*\.?$/.test(host)) { fail(8); return; }
    }
    const port = buffer.readUInt16BE(length - 2);
    if (!port) { fail(2); return; }
    const normalize = (value: string) => {
      if (value.includes(':')) { try { return new URL('http://[' + value + ']').hostname; } catch { return value; } }
      return value.toLowerCase().replace(/\.$/, '');
    };
    const hosts = options.allowedHosts ?? [], ports = options.allowedPorts ?? [];
    if ((hosts.length && !hosts.some(h => h === '*' || normalize(h) === normalize(host))) || (ports.length && !ports.includes(port))) { fail(2); return; }
    phase = 'connecting'; socket.pause(); socket.removeListener('data', read);
    const pending = buffer.subarray(length); buffer = Buffer.alloc(0);
    try { options.open(host, port, (error, channel) => {
      if (socket.destroyed) { channel?.destroy(); return; }
      if (error || !channel) { fail(5); return; }
      phase = 'done'; detach(); socket.setTimeout(0);
      socket.write(reply(0));
      if (pending.length) socket.unshift(pending);
      options.ready(channel);
    }); } catch { fail(1); }
  }
  socket.on('data', read); socket.on('end', ended); socket.resume();
}
