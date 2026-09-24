import { createServer } from 'node:http';
import { randomUUID, randomBytes } from 'node:crypto';
import { WebSocketServer, WebSocket, createWebSocketStream } from 'ws';
import type { ClientChannel } from 'ssh2';
import { Connections } from '../ssh/connections';
import { AppError } from '../../packages/core/errors';

export class VncService {
  private sessions = new Map<string, { owner: string; close(): void }>();
  private opening = 0;
  private stopped = false;
  constructor(private connections: Connections) {}
  async open(owner: string, profileId: string, host: string, port: number) {
    if(this.stopped)throw new Error('桌面服务已停止。');
    if (this.sessions.size + this.opening >= 8) throw new AppError('DESK_LIMIT', '最多同时打开8个桌面。');
    this.opening++;
    try {
      const lease = await this.connections.acquire(owner, profileId);
      if(this.stopped){this.connections.release(owner,lease.leaseId);throw new Error('桌面服务已停止。');}
      const client = this.connections.get(owner, lease.connectionId).client;
      const desktopId = randomUUID(), token = randomBytes(32).toString('hex');
      const http = createServer((_req, res) => { res.writeHead(403); res.end(); });
      const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024, perMessageDeflate: false,
        handleProtocols: () => 'binary' });
      let used = false, closed = false, channel: ClientChannel | undefined;
      const timeout = setTimeout(() => close(), 30000);
      const close = () => {
        if (closed) return; closed = true; clearTimeout(timeout);
        channel?.destroy(); for (const ws of wss.clients) ws.terminate(); wss.close(); http.close();
        client.removeListener('close', close); this.connections.release(owner, lease.leaseId); this.sessions.delete(desktopId);
      };
      client.once('close', close);
      this.sessions.set(desktopId, { owner, close });
      http.on('upgrade', (req, socket, head) => {
        const protocols = (req.headers['sec-websocket-protocol'] ?? '').split(',').map(v => v.trim());
        if (closed || used || req.url !== '/' || req.headers.origin !== 'app://hornet' || !protocols.includes(token) || !protocols.includes('binary')) {
          socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
        }
        used = true; clearTimeout(timeout);
        wss.handleUpgrade(req, socket, head, ws => {
          const stream = createWebSocketStream(ws, { highWaterMark: 65536 });
          stream.pause(); stream.on('error', close); ws.on('error', close); ws.on('close', close);
          const deadline = setTimeout(close, 15000);
          try { client.forwardOut('127.0.0.1', 0, host, port, (error, remote) => {
            clearTimeout(deadline);
            if (error || closed) { remote?.destroy(); close(); return; }
            channel = remote; remote.on('error', close); remote.on('close', close);
            remote.pipe(stream); stream.pipe(remote);
          }); } catch { clearTimeout(deadline); close(); }
        });
      });
      try {
        await new Promise<void>((resolve, reject) => { http.once('error', reject); http.listen(0, '127.0.0.1', resolve); });
        if (closed) throw new Error('VNC 启动已取消。');
        http.on('error', close);
        return { desktopId, url: `ws://127.0.0.1:${(http.address() as { port: number }).port}/`, token };
      } catch (e) { close(); throw e; }
    } finally { this.opening--; }
  }
  close(owner: string, id: string) {
    const session = this.sessions.get(id); if (!session) return;
    if (session.owner !== owner) throw new AppError('IPC005', '无权关闭此桌面。');
    session.close();
  }
  stop() { this.stopped=true;for (const session of this.sessions.values()) session.close(); }
}
