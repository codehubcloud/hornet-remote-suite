import { afterEach,expect,it } from 'vitest';
import { disconnectText,disconnectTranscript } from '../../apps/desktop/renderer/terminal-disconnect';
import { useAppearance } from '../../apps/desktop/renderer/appearance';

afterEach(()=>useAppearance.setState({value:{language:'zh-CN',theme:'light'}}));
it('uses the captured disconnect time, real error and user session title',()=>{
 const at=new Date(2026,9,16,13,33,54).getTime();
 const text=disconnectTranscript({reason:'error',at,error:'Keepalive timeout'},'生产主机');
 expect(text).toContain('连接错误：Keepalive timeout');expect(text).toContain('连接异常中断。');
 expect(text).toContain('已断开会话「生产主机」，时间 13:33:54。');
 expect(text).toContain('重新连接');expect(text).not.toContain('10053');
});
it('localizes normal, manual and device exits without inventing a local shell',()=>{
 useAppearance.setState({value:{language:'en',theme:'light'}});
 const info={at:1700000000000,reason:'remote' as const};
 expect(disconnectTranscript(info,'server')).toContain('Connection closed by remote host.');
 expect(disconnectTranscript({...info,reason:'user'},'server')).toContain('Disconnected by user.');
 const device=disconnectTranscript({...info,reason:'exit'},'PowerShell','local');
 expect(device).toContain('Terminal session ended.');expect(device).not.toContain('Reconnect');expect(device).not.toContain('[C:');
});
it('removes control sequences and line injection from untrusted errors and titles',()=>{
 expect(disconnectText('\x1b[31mhost\x1b[0m\r\nnext\x1b]2;bad title\x07')).toBe('host  next');
 const text=disconnectTranscript({reason:'error',at:1,error:'reset\r\n\x1b[2J'},'host\x1b[31m\x07');
 expect(text).not.toContain('\x1b[2J');expect(text).not.toContain('\x1b[31m');
 expect(text).not.toContain('\x1b'); // Formatting cannot inject terminal commands.
});
