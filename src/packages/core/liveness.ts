// Count responsive main-process time, not time spent asleep or with a stalled
// event loop. A late timer must give the child a chance to answer after resume.
export class Liveness {
 private last:number;private elapsed=0;private alive=0;private probe?:number;private suspended=false;
 constructor(private now:()=>number=()=>performance.now()){this.last=now();}
 time(){
  const now=this.now(),delta=now-this.last;this.last=now;
  if(!this.suspended){if(delta>=0&&delta<=10000)this.elapsed+=delta;else{this.alive=this.elapsed;this.probe=undefined;}}
  return this.elapsed;
 }
 activity(){this.alive=this.time();this.probe=undefined;}
 suspend(){this.time();this.suspended=true;}
 resume(){this.last=this.now();this.suspended=false;this.activity();}
 poll():'healthy'|'probe'|'unresponsive'{
  const now=this.time();if(this.suspended||now-this.alive<30000)return 'healthy';
  if(this.probe===undefined){this.probe=now;return 'probe';}
  return now-this.probe>=15000?'unresponsive':'healthy';
 }
}
