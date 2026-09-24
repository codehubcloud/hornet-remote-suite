import { describe,it,expect } from 'vitest';
import { parseQuickAddress } from '../../apps/desktop/renderer/quick-connect';
describe('quick connection addresses',()=>{
 it('parses hosts, usernames, explicit ports and IPv6 without passing a command',()=>{
  expect(parseQuickAddress('example.org')).toEqual({host:'example.org',port:22,username:''});
  expect(parseQuickAddress('alice@example.org:2222')).toEqual({host:'example.org',port:2222,username:'alice'});
  expect(parseQuickAddress('ssh://alice@[::1]:2222')).toEqual({host:'::1',port:2222,username:'alice'});
 });
 it.each(['ftp://host','ssh://user:secret@host','host/path','host?x=1','host#fragment','host:65536','host:0','host\ncommand','ssh://%0a@host'])('rejects unsafe or unsupported address %s',value=>{
  expect(()=>parseQuickAddress(value)).toThrow();
 });
});
