import { useEffect, useRef, useState } from 'react';
import RFB from '@novnc/novnc';
import type { View } from './store';
import { useStore } from './store';
export function VncView({ view }: { view: View }) {
  const host = useRef<HTMLDivElement>(null), rfb = useRef<RFB | null>(null);
  const [status, setStatus] = useState('正在协商 VNC'), [ask, setAsk] = useState(false), [password, setPassword] = useState('');
  useEffect(() => {
    const socket = new WebSocket(view.desktop!.url, ['binary', view.desktop!.token]);
    const client = new RFB(host.current!, socket, { shared: true }); rfb.current = client;
    client.scaleViewport = true;
    client.addEventListener('connect', () => setStatus('VNC 已连接 · SSH 加密传输'));
    client.addEventListener('disconnect', () => { setStatus('VNC 已断开'); setAsk(false); setPassword(''); void window.hornet.vnc.close(view.desktop!.desktopId).catch(useStore.getState().fail); });
    client.addEventListener('credentialsrequired', () => setAsk(true));
    client.addEventListener('securityfailure', () => { setStatus('VNC 认证或安全协商失败'); setPassword(''); });
    return () => { rfb.current = null; client.disconnect(); };
  }, [view.id]);
  return <><div className="view-meta"><span>{status}</span><button onClick={() => rfb.current?.sendCtrlAltDel()}>Ctrl+Alt+Del</button></div>
    {ask && <form className="view-meta" onSubmit={e => { e.preventDefault(); rfb.current?.sendCredentials({ password }); setPassword(''); setAsk(false); }}><label>VNC 密码<input aria-label="VNC 密码" type="password" autoComplete="off" value={password} onChange={e => setPassword(e.target.value)}/></label><button>认证</button></form>}
    <div ref={host} style={{ flex: 1, minHeight: 0, overflow: 'hidden' }} />
  </>;
}
