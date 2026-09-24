import { createServer, createConnection, type Server, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import type { Client, ClientChannel } from 'ssh2';
import { tunnelConfigSchema, type TunnelConfig, type TunnelSnapshot, type HornetEvent } from '../../packages/contracts';
import { AppError } from '../../packages/core/errors';
import { Connections } from './connections';
import { serveSocks } from './socks';

interface Tunnel {
  owner: string; snapshot: TunnelSnapshot; client: Client; server?: Server;
  streams: Set<Socket | ClientChannel>; onClose: () => void;
  abort?: () => void;
}
export class Tunnels {
  private items = new Map<string, Tunnel>();
  private handlers = new Map<Client, () => void>();
  private pending = 0;
  private stopped = false;
  private ticker: ReturnType<typeof setInterval>;
  constructor(private connections: Connections, private emit: (owner: string, event: HornetEvent) => void) {
    this.ticker = setInterval(() => {
      for (const t of this.items.values()) if (t.snapshot.state === 'listening') this.publish(t);
    }, 1000);
    this.ticker.unref();
  }
  private publish(t: Tunnel) { this.emit(t.owner, { type: 'tunnel.state', tunnel: { ...t.snapshot } }); }
  list(owner: string) { return [...this.items.values()].filter(t => t.owner === owner).map(t => ({ ...t.snapshot })); }
  async create(owner: string, input: TunnelConfig): Promise<TunnelSnapshot> {
    const config = tunnelConfigSchema.parse(input);
    if (this.stopped) throw new AppError('IPC006', '隧道服务正在停止。');
    if (this.pending + [...this.items.values()].filter(t => !['stopped', 'failed'].includes(t.snapshot.state)).length >= 32)
      throw new AppError('TUNNEL_LIMIT', '活动隧道数已达上限。');
    this.pending++;
    try {
      const lease = await this.connections.acquire(owner, config.profileId);
      if (this.stopped) { this.connections.release(owner, lease.leaseId); throw new AppError('IPC006', '隧道服务已停止。'); }
      const client = this.connections.get(owner, lease.connectionId).client;
      const t: Tunnel = { owner, client, streams: new Set(), onClose: () => this.cleanup(t, 'failed', 'SSH 连接已断开。'),
        snapshot: { ...config, ...lease, tunnelId: randomUUID(), state: 'starting', activeStreams: 0, bytesToTarget: 0, bytesFromTarget: 0 } };
      // Bound retained history without discarding active listeners.
      if (this.items.size >= 128) {
        const old = [...this.items.values()].find(v => ['stopped', 'failed'].includes(v.snapshot.state));
        if (old) this.items.delete(old.snapshot.tunnelId);
      }
      this.items.set(t.snapshot.tunnelId, t);
      client.once('close', t.onClose);
      this.publish(t);
      try {
        if (config.kind !== 'remote') await this.listenLocal(t);
        else { this.routeRemote(client); await this.listenRemote(t); }
        if (t.snapshot.state !== 'starting') throw new Error('隧道启动已取消。');
        t.snapshot.state = 'listening'; this.publish(t);
        return { ...t.snapshot };
      } catch (error) {
        this.cleanup(t, 'failed', error instanceof Error ? error.message : '无法创建隧道。');
        throw new AppError('TUNNEL_START', t.snapshot.error ?? '无法创建隧道。');
      }
    } finally { this.pending--; }
  }
  private listenLocal(t: Tunnel) {
    return new Promise<void>((resolve, reject) => {
      t.abort = () => reject(new Error('隧道启动已取消。'));
      const server = t.server = createServer({ pauseOnConnect: true, allowHalfOpen: true }, socket => {
        if (t.snapshot.state !== 'listening' || t.snapshot.activeStreams >= 64) { socket.destroy(); return; }
        this.track(t, socket);
        socket.setTimeout(15000, () => socket.destroy());
        if (t.snapshot.kind === 'dynamic') {
          serveSocks(socket, {
            allowedHosts: t.snapshot.allowedHosts, allowedPorts: t.snapshot.allowedPorts,
            open: (host, port, callback) => t.client.forwardOut(socket.remoteAddress ?? '127.0.0.1', socket.remotePort ?? 0, host, port, (error, channel) => {
              if (error) this.streamError(t, 'SOCKS 目标连接被拒绝或不可达。');
              callback(error, channel);
            }),
            ready: channel => {
              if (t.snapshot.state !== 'listening') { channel.destroy(); socket.destroy(); return; }
              this.bridge(t, socket, channel);
            },
          });
          return;
        }
        t.client.forwardOut(socket.remoteAddress ?? '127.0.0.1', socket.remotePort ?? 0, t.snapshot.targetHost, t.snapshot.targetPort, (error, channel) => {
          if (error) { this.streamError(t, '目标连接被拒绝或不可达。'); socket.destroy(); return; }
          if (socket.destroyed || t.snapshot.state !== 'listening') { channel.destroy(); return; }
          socket.setTimeout(0);
          this.bridge(t, socket, channel);
        });
      });
      server.on('error', (error: NodeJS.ErrnoException) => {
        const message = error.code === 'EADDRINUSE' ? '监听端口已被占用。' : '无法监听此地址或端口。';
        if (t.snapshot.state === 'starting') reject(new Error(message));
        else this.cleanup(t, 'failed', message);
      });
      server.listen(t.snapshot.bindPort, t.snapshot.bindHost, () => {
        if (t.snapshot.state !== 'starting') { server.close(); reject(new Error('隧道启动已取消。')); return; }
        t.snapshot.bindPort = (server.address() as { port: number }).port;
        t.abort = undefined; resolve();
      });
    });
  }
  private listenRemote(t: Tunnel) {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('远程监听请求超时。')), 15000);
      t.abort = () => { clearTimeout(timer); reject(new Error('隧道启动已取消。')); };
      t.client.forwardIn(t.snapshot.bindHost, t.snapshot.bindPort, (error, port) => {
        clearTimeout(timer); t.abort = undefined;
        if (error) { reject(new Error('远程端口被占用或服务器禁止转发。')); return; }
        const assigned = port || t.snapshot.bindPort;
        if (t.snapshot.state !== 'starting') { t.client.unforwardIn(t.snapshot.bindHost, assigned, () => {}); return; }
        if (!Number.isInteger(assigned) || assigned < 1 || assigned > 65535) { reject(new Error('服务器未返回有效的监听端口。')); return; }
        t.snapshot.bindPort = assigned; resolve();
      });
    });
  }
  private routeRemote(client: Client) {
    if (this.handlers.has(client)) return;
    const handler = (details: { destIP: string; destPort: number }, accept: () => ClientChannel, reject: () => void) => {
      const t = [...this.items.values()].find(t => t.client === client && t.snapshot.kind === 'remote' && t.snapshot.state === 'listening'
        && t.snapshot.bindHost === details.destIP && t.snapshot.bindPort === details.destPort);
      if (!t || t.snapshot.activeStreams >= 64) { reject(); return; }
      const channel = accept(); channel.pause(); channel.on('error', () => {});
      t.streams.add(channel);
      const socket = createConnection({ host: t.snapshot.targetHost, port: t.snapshot.targetPort, allowHalfOpen: true });
      this.track(t, socket);
      socket.setTimeout(15000, () => { this.streamError(t, '本地目标连接超时。'); socket.destroy(); });
      socket.once('error', () => this.streamError(t, '本地目标连接被拒绝或不可达。'));
      socket.once('close', () => { channel.destroy(); t.streams.delete(channel); });
      channel.once('close', () => socket.destroy());
      socket.once('connect', () => {
        if (t.snapshot.state !== 'listening') { socket.destroy(); return; }
        socket.setTimeout(0); this.bridge(t, socket, channel);
      });
    };
    client.on('tcp connection', handler);
    const detach = () => { client.removeListener('tcp connection', handler); this.handlers.delete(client); };
    this.handlers.set(client, detach);
    client.once('close', detach);
  }
  private track(t: Tunnel, socket: Socket) {
    t.streams.add(socket); t.snapshot.activeStreams++;
    socket.on('error', () => {});
    socket.once('close', () => { t.streams.delete(socket); t.snapshot.activeStreams = Math.max(0, t.snapshot.activeStreams - 1); this.publish(t); });
  }
  private bridge(t: Tunnel, socket: Socket, channel: ClientChannel) {
    t.streams.add(channel);
    channel.on('error', () => socket.destroy());
    channel.once('close', () => { t.streams.delete(channel); socket.destroy(); });
    socket.once('close', () => channel.destroy());
    const to = t.snapshot.kind !== 'remote' ? 'bytesToTarget' : 'bytesFromTarget';
    const from = t.snapshot.kind !== 'remote' ? 'bytesFromTarget' : 'bytesToTarget';
    socket.on('data', data => { t.snapshot[to] += data.length; });
    channel.on('data', (data: Buffer) => { t.snapshot[from] += data.length; });
    socket.pipe(channel); channel.pipe(socket);
  }
  private streamError(t: Tunnel, message: string) { t.snapshot.error = message; this.publish(t); }
  private cleanup(t: Tunnel, state: 'stopped'|'failed', error?: string) {
    if (['stopped', 'failed'].includes(t.snapshot.state)) return;
    t.snapshot.state = state; t.snapshot.error = error;
    t.abort?.(); t.abort = undefined;
    t.server?.close();
    for (const stream of t.streams) stream.destroy();
    t.streams.clear(); t.snapshot.activeStreams = 0;
    t.client.removeListener('close', t.onClose);
    this.connections.release(t.owner, t.snapshot.leaseId); this.publish(t);
  }
  async stop(owner: string, id: string) {
    const t = this.items.get(id);
    if (!t || t.owner !== owner) throw new AppError('IPC005', '无权停止此隧道。');
    if (['stopped', 'failed'].includes(t.snapshot.state)) return;
    if (t.snapshot.state === 'stopping') throw new AppError('TUNNEL_BUSY', '隧道正在停止。');
    if (t.snapshot.kind === 'remote' && t.snapshot.state === 'listening') {
      t.snapshot.state = 'stopping'; this.publish(t);
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('停止远程监听超时，请重试或断开 SSH。')), 10000);
          t.client.unforwardIn(t.snapshot.bindHost, t.snapshot.bindPort, error => {
            clearTimeout(timer);
            if (error) reject(new Error('服务器未确认停止监听。'));
            else { this.cleanup(t, 'stopped'); resolve(); }
          });
        });
      } catch (error) {
        if (t.snapshot.state === 'stopping') { t.snapshot.state = 'listening'; this.streamError(t, (error as Error).message); }
        throw error;
      }
    }
    this.cleanup(t, 'stopped');
  }
  shutdown() {
    this.stopped = true; clearInterval(this.ticker);
    // The caller closes all SSH transports immediately after this cleanup.
    for (const t of this.items.values()) this.cleanup(t, 'stopped');
    for (const detach of this.handlers.values()) detach();
  }
}
