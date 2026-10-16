import { z } from 'zod';
import type { CSSProperties } from 'react';

const color=z.string().regex(/^#[0-9a-fA-F]{6}$/);
const text={textColor:color.optional()};
export const quickCommandAppearanceSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('solid'),color,...text}).strict(),
 z.object({kind:z.literal('linear'),from:color,to:color,angle:z.number().int().min(0).max(360),...text}).strict(),
 z.object({kind:z.literal('radial'),from:color,to:color,...text}).strict(),
]);
export type QuickCommandAppearance=z.infer<typeof quickCommandAppearanceSchema>;
const rgb=(hex:string)=>[1,3,5].map(index=>parseInt(hex.slice(index,index+2),16));
function luminance(values:number[]){const linear=values.map(value=>{const n=value/255;return n<=0.04045?n/12.92:((n+0.055)/1.055)**2.4;});return linear[0]*0.2126+linear[1]*0.7152+linear[2]*0.0722;}
export function commandTextColor(appearance:QuickCommandAppearance){
 if(appearance.textColor)return appearance.textColor;
 const from=rgb(appearance.kind==='solid'?appearance.color:appearance.from),to=rgb(appearance.kind==='solid'?appearance.color:appearance.to);
 const stops=Array.from({length:9},(_,i)=>luminance(from.map((value,index)=>value+(to[index]-value)*i/8)));
 const contrast=(hex:string)=>{const text=luminance(rgb(hex));return Math.min(...stops.map(background=>(Math.max(text,background)+0.05)/(Math.min(text,background)+0.05)));};
 return contrast('#ffffff')>=contrast('#111827')?'#ffffff':'#111827';
}
/** Generate CSS only from validated colors; imported commands cannot supply CSS or URLs. */
export function quickCommandStyle(value:QuickCommandAppearance|undefined):CSSProperties|undefined{
 if(!value)return undefined;
 const parsed=quickCommandAppearanceSchema.safeParse(value);if(!parsed.success)return undefined;
 const appearance=parsed.data,from=appearance.kind==='solid'?appearance.color:appearance.from;
 return {backgroundColor:from,backgroundImage:appearance.kind==='solid'?'none':appearance.kind==='linear'?`linear-gradient(${appearance.angle}deg, ${appearance.from}, ${appearance.to})`:`radial-gradient(circle, ${appearance.from}, ${appearance.to})`,color:commandTextColor(appearance),borderColor:from};
}
