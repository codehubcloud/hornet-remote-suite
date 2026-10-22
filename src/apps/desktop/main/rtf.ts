export function plainRtf(text:string){
 let body='';
 for(let i=0;i<text.length;i++){
  const ch=text[i],code=text.charCodeAt(i);
  body+=ch==='\\'||ch==='{'||ch==='}'?'\\'+ch:ch==='\n'?'\\par\n':ch==='\r'?'':code>127?'\\u'+(code>32767?code-65536:code)+'?':ch;
 }
 return '{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Consolas;}}\\f0 '+body+'}';
}
