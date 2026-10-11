import type { HornetEvent } from '../../../packages/contracts';
import { t } from './i18n';
type Challenge=Pick<Extract<HornetEvent,{type:'challenge'}>,'kind'|'title'|'message'>;
export function challengeCopy(challenge:Challenge){
 // Remote keyboard-interactive prompts, usernames and fingerprints stay verbatim.
 let message=challenge.message;
 if(challenge.kind==='privateKey'||challenge.kind==='passphrase')message=t(message);
 if(challenge.kind==='trust'){
  const suffix='\n请通过可信渠道核对，接受后保存。';
  if(message.endsWith(suffix))message=message.slice(0,-suffix.length)+'\n'+t('请通过可信渠道核对，接受后保存。');
 }
 return {title:t(challenge.title),message};
}
