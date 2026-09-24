import { describe, it, expect } from 'vitest';
import { createServer, createConnection, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { sshFixture } from '../fixtures/ssh-server';
import { Storage } from '../../packages/storage/database';
import { Challenges } from '../../packages/security/challenges';
import { Connections } from '../../services/ssh/connections';
import { Tunnels } from '../../services/ssh/tunnels';
import { tunnelConfigSchema, type HornetEvent } from '../../packages/contracts';

async function waitFor(test: () => boolean) {
  const end = Date.now() + 5000;
  while (!test()) { if (Date.now() > end) throw new Error('Timeout'); await new Promise(r => setTimeout(r, 20)); }
}
async function harness() {
  const ssh = await sshFixture(), root = await mkdtemp(join(tmpdir(), 'hornet-tunnel-'));
  const db = new Storage(join(root, 'test.db'), resolve('packages/storage/schema.sql'));
  const profile = db.saveProfile({ profileId: randomUUID(), name: 'tunnel', host: '127.0.0.1', port: ssh.port, username: 'tester', authType: 'password', group: '', revision: 0 }, 0);
  const events: HornetEvent[] = [];
  const emit = (owner: string, e: HornetEvent) => {
    events.push(e);
    if (e.type === 'challenge') queueMicrotask(() => challenges.respond(owner, e.challengeId, e.kind === 'trust' ? 'accept' : 'test-password', e.kind === 'trust'));
  };
  const challenges = new Challenges(emit), connections = new Connections(db, challenges, emit, undefined, 30), tunnels = new Tunnels(connections, emit);
  const sockets = new Set<Socket>();
  const echo = createServer({ allowHalfOpen: true }, socket => {
    sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket));
    // Reply only after EOF, exercising TCP half-close in both directions.
    const chunks: Buffer[] = []; socket.on('data', data => chunks.push(Buffer.from(data))); socket.on('end', () => socket.end(Buffer.concat(chunks)));
  });
  await new Promise<void>(r => echo.listen(0, '127.0.0.1', r));
  const targetPort = (echo.address() as { port: number }).port;
  return { ssh, profile, connections, tunnels, events, targetPort, async close() {
    tunnels.shutdown(); await connections.stop(); await ssh.close();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(r => echo.close(() => r())); db.close(); await rm(root, { recursive: true, force: true });
  } };
}
async function exchange(port: number, data: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port, allowHalfOpen: true });
    const chunks: Buffer[] = [];
    socket.setTimeout(5000, () => socket.destroy(new Error('TCP timeout')));
    socket.on('error', reject);
    socket.on('connect', () => socket.end(data));
    socket.on('data', chunk => chunks.push(Buffer.from(chunk)));
    socket.on('end', () => { socket.destroy(); resolve(Buffer.concat(chunks)); });
  });
}
describe('real SSH forwarding', () => {
  it('SOCKS5 forwards fragmented IPv4 and pipelined remote-DNS requests with exact payload statistics', async () => {
    const h = await harness();
    try {
      const tunnel = await h.tunnels.create('a', { profileId: h.profile.profileId, kind: 'dynamic', bindHost: '127.0.0.1', bindPort: 0, targetHost: 'unused', targetPort: 1 });
      const payload = Buffer.from('binary\0\xff payload');
      for (const domain of [false, true]) {
        const destination = domain ? Buffer.concat([Buffer.from([3,16]),Buffer.from('fixture.internal')]) : Buffer.from([1,127,0,0,1]);
        const port = Buffer.alloc(2);port.writeUInt16BE(h.targetPort);
        const request = Buffer.concat([Buffer.from([5,1,0,5,1,0]),destination,port,payload]);
        const response = await socksExchange(tunnel.bindPort,request,!domain);
        expect([...response.subarray(0,4)]).toEqual([5,0,5,0]);
        expect(response.subarray(12).equals(payload)).toBe(true);
      }
      await waitFor(()=>h.tunnels.list('a')[0].activeStreams===0);
      expect(h.tunnels.list('a')[0].bytesToTarget).toBe(payload.length*2);
      expect(h.tunnels.list('a')[0].bytesFromTarget).toBe(payload.length*2);
      await h.tunnels.stop('a',tunnel.tunnelId);
      await expect(exchange(tunnel.bindPort,Buffer.from('closed'))).rejects.toThrow();
    } finally { await h.close(); }
  });
  it('SOCKS5 enforces destination policy and rejects unsupported authentication/commands/addresses', async () => {
    const h=await harness();
    try {
      const t=await h.tunnels.create('a',{profileId:h.profile.profileId,kind:'dynamic',bindHost:'127.0.0.1',bindPort:0,targetHost:'unused',targetPort:1,allowedHosts:['fixture.internal','::1'],allowedPorts:[h.targetPort]});
      const denied=await socksExchange(t.bindPort,Buffer.from([5,1,0,5,1,0,1,127,0,0,1,0,80]));
      expect(denied[3]).toBe(2);
      const badPort=Buffer.concat([Buffer.from([5,1,0,5,1,0,3,16]),Buffer.from('fixture.internal'),Buffer.from([0,0])]);
      expect((await socksExchange(t.bindPort,badPort))[3]).toBe(2);
      expect([...await socksExchange(t.bindPort,Buffer.from([5,1,2]))]).toEqual([5,255]);
      for(const command of [2,3])expect((await socksExchange(t.bindPort,Buffer.from([5,1,0,5,command,0,1])))[3]).toBe(7);
      expect((await socksExchange(t.bindPort,Buffer.from([5,1,0,5,1,0,9])))[3]).toBe(8);
      const allowedPort=Buffer.alloc(2);allowedPort.writeUInt16BE(h.targetPort);
      const ipv6=Buffer.alloc(16);ipv6[15]=1;
      // IPv6 is parsed and matches compressed policy; fixture rejects IPv6 forwarding.
      expect((await socksExchange(t.bindPort,Buffer.concat([Buffer.from([5,1,0,5,1,0,4]),ipv6,allowedPort])))[3]).toBe(5);
      const blockedPort=Buffer.alloc(2);blockedPort.writeUInt16BE(h.targetPort===65535?65534:h.targetPort+1);
      expect((await socksExchange(t.bindPort,Buffer.concat([Buffer.from([5,1,0,5,1,0,3,16]),Buffer.from('fixture.internal'),blockedPort])))[3]).toBe(2);
      const allowed=Buffer.concat([Buffer.from([5,1,0,5,1,0,3,16]),Buffer.from('fixture.internal'),allowedPort,Buffer.from('ok')]);
      expect((await socksExchange(t.bindPort,allowed)).subarray(12).toString()).toBe('ok');
      const pending=createConnection({host:'127.0.0.1',port:t.bindPort});pending.on('error',()=>{});
      try{await waitFor(()=>h.tunnels.list('a')[0].activeStreams>0);await h.tunnels.stop('a',t.tunnelId);await waitFor(()=>pending.destroyed);}finally{pending.destroy();}
    }finally{await h.close();}
  });
  for (const kind of ['local', 'remote'] as const) it(`${kind}: forwards binary data, owns a lease, isolates owners and stops listeners`, async () => {
    const h = await harness();
    try {
      const view = await h.connections.acquire('a', h.profile.profileId);
      const tunnel = await h.tunnels.create('a', { profileId: h.profile.profileId, kind, bindHost: '127.0.0.1', bindPort: 0, targetHost: '127.0.0.1', targetPort: h.targetPort });
      expect(tunnel.bindPort).toBeGreaterThan(0);
      expect(tunnel.connectionId).toBe(view.connectionId);
      expect(h.ssh.authCount).toBe(1);
      h.connections.release('a', view.leaseId);
      await new Promise(r => setTimeout(r, 80));
      expect(h.connections.hasProfile(h.profile.profileId)).toBe(true);
      expect(h.tunnels.list('b')).toEqual([]);
      await expect(h.tunnels.stop('b', tunnel.tunnelId)).rejects.toThrow();
      const payload = Buffer.alloc(256 * 1024, 0xa7);
      const response = await exchange(tunnel.bindPort, payload);
      expect(response.length).toBe(payload.length);
      expect(response.equals(payload)).toBe(true);
      await waitFor(() => h.tunnels.list('a')[0].activeStreams === 0);
      expect(h.tunnels.list('a')[0].bytesToTarget).toBe(payload.length);
      expect(h.tunnels.list('a')[0].bytesFromTarget).toBe(payload.length);
      await h.tunnels.stop('a', tunnel.tunnelId);
      await h.tunnels.stop('a', tunnel.tunnelId);
      await expect(exchange(tunnel.bindPort, Buffer.from('closed'))).rejects.toThrow();
      await waitFor(() => !h.connections.hasProfile(h.profile.profileId));
    } finally { await h.close(); }
  });
  it('reports port conflicts and releases listeners when SSH disconnects', async () => {
    const h = await harness();
    try {
      const config = { profileId: h.profile.profileId, kind: 'local' as const, bindHost: '127.0.0.1' as const, bindPort: h.targetPort, targetHost: '127.0.0.1', targetPort: h.targetPort };
      await expect(h.tunnels.create('a', config)).rejects.toThrow('占用');
      const local = await h.tunnels.create('a', { ...config, bindPort: 0 });
      const remote = await h.tunnels.create('a', { ...config, kind: 'remote', bindPort: 0 });
      await expect(h.tunnels.create('a', { ...config, kind: 'remote', bindPort: remote.bindPort })).rejects.toThrow();
      h.ssh.disconnect();
      await waitFor(() => h.tunnels.list('a').every(t => t.state === 'failed'));
      await expect(exchange(local.bindPort, Buffer.from('closed'))).rejects.toThrow();
      await expect(exchange(remote.bindPort, Buffer.from('closed'))).rejects.toThrow();
    } finally { await h.close(); }
  });
  it('rejects wildcard listeners and invalid destination ports', () => {
    const config = { profileId: randomUUID(), kind: 'local', bindHost: '127.0.0.1', bindPort: 0, targetHost: 'localhost', targetPort: 80 };
    expect(tunnelConfigSchema.safeParse(config).success).toBe(true);
    expect(tunnelConfigSchema.safeParse({ ...config, bindHost: '0.0.0.0' }).success).toBe(false);
    expect(tunnelConfigSchema.safeParse({ ...config, targetPort: 0 }).success).toBe(false);
  });
  for (const kind of ['local', 'remote'] as const) it(`${kind}: stopping destroys active TCP streams without closing another lease`, async () => {
    const h = await harness(); let socket: Socket | undefined;
    try {
      const view = await h.connections.acquire('a', h.profile.profileId);
      const tunnel = await h.tunnels.create('a', { profileId: h.profile.profileId, kind, bindHost: '127.0.0.1', bindPort: 0, targetHost: '127.0.0.1', targetPort: h.targetPort });
      socket = createConnection({ host: '127.0.0.1', port: tunnel.bindPort });
      socket.on('error', () => {});
      await waitFor(() => h.tunnels.list('a')[0].activeStreams === 1);
      await h.tunnels.stop('a', tunnel.tunnelId);
      await waitFor(() => socket!.destroyed);
      expect(h.tunnels.list('a')[0].activeStreams).toBe(0);
      expect(h.connections.get('a', view.connectionId).id).toBe(view.connectionId);
      expect(h.ssh.authCount).toBe(1);
    } finally { socket?.destroy(); await h.close(); }
  });
});

async function socksExchange(port:number,request:Buffer,fragmented=false){
  return new Promise<Buffer>((resolve,reject)=>{
    const socket=createConnection({host:'127.0.0.1',port,allowHalfOpen:true});let received=Buffer.alloc(0),sent=false;
    const finish=()=>{if(sent&&received.length>=12&&received[3]===0&&!socket.writableEnded)socket.end();};
    socket.setTimeout(5000,()=>socket.destroy(new Error('SOCKS test timeout')));
    socket.on('error',reject);
    socket.on('connect',()=>{
      if(!fragmented){socket.write(request);sent=true;finish();return;}
      let index=0;
      const send=()=>{if(socket.destroyed)return;if(index===request.length){sent=true;finish();return;}socket.write(request.subarray(index,index+1));index++;setTimeout(send,1);};send();
    });
    socket.on('data',chunk=>{received=Buffer.concat([received,Buffer.from(chunk)]);finish();});
    socket.on('end',()=>{socket.destroy();resolve(received);});
  });
}
