import { describe,it,expect } from 'vitest';
import { readStartupSessions } from '../../apps/desktop/renderer/session-dialog-preferences';
describe('startup sessions preference',()=>{
 it('opens by default and disables only for an explicit saved choice',()=>{
  for(const raw of [null,'true','invalid','{}'])expect(readStartupSessions(raw)).toBe(true);
  expect(readStartupSessions('false')).toBe(false);
 });
});
