import { z } from 'zod';
export const scheduleInput=z.object({profileId:z.string().uuid(),direction:z.enum(['upload','download']),remotePath:z.string().min(1).max(4096).refine(value=>!/[\x00-\x1f\x7f]/.test(value)),at:z.number().int().positive()}).strict();
export type ScheduleInput=z.infer<typeof scheduleInput>;
export interface TransferSchedule extends ScheduleInput {id:string;profileRevision:number;profileName:string;localPath:string;localParent:string;state:'scheduled'|'waiting'|'starting'|'submitted'|'failed'|'cancelled';taskId?:string;error?:string}
