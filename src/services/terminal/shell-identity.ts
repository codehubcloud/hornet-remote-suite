import { randomUUID } from 'node:crypto';

// The wrapper is run with a PTY before accepting user input. exec preserves its
// PID, so Linux /proc exposes the actual login shell's cwd without prompt parsing
// or injecting commands into a shell that might be running an editor/password UI.
export class ShellIdentity {
 readonly token=randomUUID();
 private readonly script=`printf '\\033]1337;HornetPID=${this.token};%s\\007' "$$"; exec "\${SHELL:-/bin/sh}" -l`;
 readonly command="sh -c '"+this.script.replaceAll("'",String.fromCharCode(39,92,39,39))+"'";
 pid?:string;
 private tail='';
 feed(data:Buffer){
  if(this.pid)return;
  const text=this.tail+data.toString('latin1');
  const match=new RegExp('\\x1b\\]1337;HornetPID='+this.token+';([1-9][0-9]{0,9})\\x07').exec(text);
  if(match){this.pid=match[1];this.tail='';}else this.tail=text.slice(-128);
 }
}
