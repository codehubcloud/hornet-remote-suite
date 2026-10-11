import { z } from 'zod';
export const x11PresetSchema=z.object({id:z.string().uuid(),name:z.string().trim().min(1).max(80),profileId:z.string().uuid(),command:z.string().trim().min(1).max(4096),kind:z.enum(['managed','external']),display:z.number().int().min(0).max(99),dpi:z.number().int().min(72).max(240),mode:z.enum(['multiWindow','singleWindow'])}).strict();
export type X11Preset=z.infer<typeof x11PresetSchema>;
const key='hornet.x11.presets.v1';
export function readX11Presets():X11Preset[]{try{return z.array(x11PresetSchema).max(100).parse(JSON.parse(localStorage.getItem(key)??'[]'));}catch{return [];}}
export function writeX11Presets(value:X11Preset[]){localStorage.setItem(key,JSON.stringify(z.array(x11PresetSchema).max(100).parse(value)));}
