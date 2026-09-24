import { useEffect, useState } from 'react';
import { tunnelConfigSchema, type TunnelConfig, type TunnelSnapshot } from '../../../packages/contracts';
import { useStore } from './store';
import { formatBytes } from './FileView';

const stateLabels = { starting: '正在启动', listening: '监听中', stopping: '正在停止', stopped: '已停止', failed: '失败' };
export function TunnelPanel() {
  const profiles = useStore(s => s.profiles), fail = useStore(s => s.fail);
  const [tunnels, setTunnels] = useState<TunnelSnapshot[]>([]);
  const [busy, setBusy] = useState(false);
  const [hosts, setHosts] = useState(''), [ports, setPorts] = useState('');
  const [config, setConfig] = useState<TunnelConfig>({ profileId: '', kind: 'local', bindHost: '127.0.0.1', bindPort: 0, targetHost: '127.0.0.1', targetPort: 80 });
  const merge = (tunnel: TunnelSnapshot) => setTunnels(items => [tunnel, ...items.filter(t => t.tunnelId !== tunnel.tunnelId)].slice(0, 128));
  useEffect(() => {
    let mounted = true;
    const off = window.hornet.onEvent(e => { if (e.type === 'tunnel.state') merge(e.tunnel); });
    void window.hornet.tunnel.list().then(items => {
      if (mounted) setTunnels(current => [...current, ...items.filter(t => !current.some(c => c.tunnelId === t.tunnelId))].slice(0, 128));
    }).catch(fail);
    return () => { mounted = false; off(); };
  }, []);
  async function create() {
    setBusy(true);
    try {
      const parsed = tunnelConfigSchema.parse({ ...config, ...(config.kind === 'dynamic' ? { targetHost: '127.0.0.1', targetPort: 1 } : {}), allowedHosts: hosts.split(/[,，\s]+/).filter(Boolean), allowedPorts: ports.split(/[,，\s]+/).filter(Boolean).map(Number), profileId: config.profileId || profiles[0]?.profileId });
      merge(await window.hornet.tunnel.create(parsed));
    } catch (e) { fail(e); } finally { setBusy(false); }
  }
  return <section className="tunnel-panel">
    <h2>SSH 端口转发</h2>
    <p className="muted">隧道独立运行，关闭终端不会停止转发；退出应用后不会自动重启。</p>
    <form className="tunnel-form" onSubmit={e => { e.preventDefault(); void create(); }}>
      <label>SSH 主机<select aria-label="隧道 SSH 主机" required value={config.profileId || profiles[0]?.profileId || ''} onChange={e => setConfig({ ...config, profileId: e.target.value })}>
        {!profiles.length && <option value="">请先新建 SSH 连接</option>}
        {profiles.map(p => <option key={p.profileId} value={p.profileId}>{p.name}</option>)}
      </select></label>
      <label>转发类型<select aria-label="转发类型" value={config.kind} onChange={e => setConfig({ ...config, kind: e.target.value as TunnelConfig['kind'] })}><option value="local">本地 → 远程目标</option><option value="remote">远程 → 本地目标</option><option value="dynamic">动态 SOCKS5 代理</option></select></label>
      <label>监听地址<select aria-label="监听地址" value={config.bindHost} onChange={e => setConfig({ ...config, bindHost: e.target.value as TunnelConfig['bindHost'] })}><option>127.0.0.1</option><option>::1</option></select></label>
      <label>监听端口<input aria-label="隧道监听端口" required type="number" min={0} max={65535} value={config.bindPort} onChange={e => setConfig({ ...config, bindPort: Number(e.target.value) })}/></label>
      {config.kind !== 'dynamic' && <><label>目标地址<input aria-label="隧道目标地址" required value={config.targetHost} onChange={e => setConfig({ ...config, targetHost: e.target.value })}/></label>
      <label>目标端口<input aria-label="隧道目标端口" required type="number" min={1} max={65535} value={config.targetPort} onChange={e => setConfig({ ...config, targetPort: Number(e.target.value) })}/></label></>}
      {config.kind === 'dynamic' && <><label>允许的目标<input aria-label="SOCKS 允许目标" placeholder="留空允许全部；多个地址用逗号分隔" value={hosts} onChange={e => setHosts(e.target.value)}/></label><label>允许的端口<input aria-label="SOCKS 允许端口" placeholder="留空允许全部，例如 80,443" value={ports} onChange={e => setPorts(e.target.value)}/></label></>}
      <button className="primary" disabled={busy || !profiles.length}>{busy ? '正在创建…' : '创建隧道'}</button>
    </form>
    <p className="muted">监听端口 0 表示自动分配。{config.kind === 'dynamic' ? 'SOCKS5 仅支持无认证 TCP CONNECT，本机其他程序可访问此代理。域名由 SSH 服务器解析；目标白名单按请求中的地址精确匹配，不按解析后的 IP 匹配。' : config.kind === 'local' ? '目标地址由 SSH 服务器解析和连接。' : '目标地址由本机解析和连接。请求服务器仅监听回环地址；服务器 GatewayPorts 配置可能改变实际绑定范围，使用前请核对。'}</p>
    <div className="tunnel-list">{!tunnels.length && <p className="muted">暂无隧道。</p>}{tunnels.map(t => <article className="tunnel-row" key={t.tunnelId}>
      <div><strong>{profiles.find(p => p.profileId === t.profileId)?.name ?? 'SSH'} · {t.kind === 'dynamic' ? 'SOCKS5 代理' : t.kind === 'local' ? '本地转发' : '远程转发'}</strong>
        <p className="tunnel-address">[{t.bindHost}]:{t.bindPort} → {t.kind === 'dynamic' ? '按客户端请求连接' : t.targetHost + ':' + t.targetPort}</p>
        {t.kind === 'dynamic' && <p className="tunnel-address">允许目标：{t.allowedHosts?.length ? t.allowedHosts.join(', ') : '全部'} · 允许端口：{t.allowedPorts?.length ? t.allowedPorts.join(', ') : '全部'}</p>}
        <small>{stateLabels[t.state]} · {t.activeStreams} 个连接 · 发往目标 {formatBytes(t.bytesToTarget)} / 来自目标 {formatBytes(t.bytesFromTarget)}</small>
        {t.error && <p className="form-error">{t.error}</p>}
      </div>
      <button disabled={!['starting', 'listening'].includes(t.state)} onClick={() => void window.hornet.tunnel.stop(t.tunnelId).catch(fail)}>停止隧道</button>
    </article>)}</div>
  </section>;
}
