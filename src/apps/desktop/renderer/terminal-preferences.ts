import { z } from 'zod';
import { create } from 'zustand';
import { quickCommandAppearanceSchema } from './quick-command-appearance';
import { terminalPreferencesSchema } from '../../../packages/contracts/session-options';
export { terminalPreferencesSchema } from '../../../packages/contracts/session-options';

export type TerminalPreferences=z.infer<typeof terminalPreferencesSchema>;
export const terminalDefaults:TerminalPreferences={fontSize:14,font:'cascadia',theme:'hornet',scrollback:10000,cursorStyle:'block',cursorBlink:true};
export const terminalFonts={cascadia:'Cascadia Code, Consolas, monospace',consolas:'Consolas, monospace',courier:'Courier New, monospace'};
const studioLightAnsi={black:'#000000',red:'#cd3131',green:'#107c10',yellow:'#795e26',blue:'#0451a5',magenta:'#bc05bc',cyan:'#0598bc',white:'#555555',brightBlack:'#666666',brightRed:'#cd3131',brightGreen:'#14ce14',brightYellow:'#b89500',brightBlue:'#0451a5',brightMagenta:'#bc05bc',brightCyan:'#0598bc',brightWhite:'#a5a5a5'};
const studioDarkAnsi={black:'#000000',red:'#cd3131',green:'#0dbc79',yellow:'#e5e510',blue:'#2472c8',magenta:'#bc3fbc',cyan:'#11a8cd',white:'#e5e5e5',brightBlack:'#666666',brightRed:'#f14c4c',brightGreen:'#23d18b',brightYellow:'#f5f543',brightBlue:'#3b8eea',brightMagenta:'#d670d6',brightCyan:'#29b8db',brightWhite:'#ffffff'};
export const terminalThemes={
 hornet:{background:'#0b1220',foreground:'#d5e0ee',cursor:'#38d9c4',selectionBackground:'#29485d'},
 light:{background:'#fafafa',foreground:'#202020',cursor:'#156b9e',selectionBackground:'#b6d8f0'},
 'github-light':{background:'#ffffff',foreground:'#1f2328',cursor:'#0969da',selectionBackground:'#b6e3ff',black:'#24292f',red:'#cf222e',green:'#116329',yellow:'#4d2d00',blue:'#0969da',magenta:'#8250df',cyan:'#1b7c83',white:'#6e7781',brightBlack:'#57606a',brightRed:'#a40e26',brightGreen:'#1a7f37',brightYellow:'#633c01',brightBlue:'#218bff',brightMagenta:'#a475f9',brightCyan:'#3192aa',brightWhite:'#8c959f'},
 'github-dark':{background:'#0d1117',foreground:'#e6edf3',cursor:'#58a6ff',selectionBackground:'#264f78',black:'#484f58',red:'#ff7b72',green:'#3fb950',yellow:'#d29922',blue:'#58a6ff',magenta:'#bc8cff',cyan:'#39c5cf',white:'#b1bac4',brightBlack:'#6e7681',brightRed:'#ffa198',brightGreen:'#56d364',brightYellow:'#e3b341',brightBlue:'#79c0ff',brightMagenta:'#d2a8ff',brightCyan:'#56d4dd',brightWhite:'#f0f6fc'},
 'vscode-light':{background:'#ffffff',foreground:'#3b3b3b',cursor:'#005fb8',selectionBackground:'#add6ff',black:'#000000',red:'#cd3131',green:'#107c10',yellow:'#795e26',blue:'#0451a5',magenta:'#bc05bc',cyan:'#0598bc',white:'#555555',brightBlack:'#666666',brightRed:'#cd3131',brightGreen:'#14ce14',brightYellow:'#b89500',brightBlue:'#0451a5',brightMagenta:'#bc05bc',brightCyan:'#0598bc',brightWhite:'#a5a5a5'},
 'vscode-dark':{background:'#1f1f1f',foreground:'#cccccc',cursor:'#ffffff',selectionBackground:'#264f78',black:'#000000',red:'#cd3131',green:'#0dbc79',yellow:'#e5e510',blue:'#2472c8',magenta:'#bc3fbc',cyan:'#11a8cd',white:'#e5e5e5',brightBlack:'#666666',brightRed:'#f14c4c',brightGreen:'#23d18b',brightYellow:'#f5f543',brightBlue:'#3b8eea',brightMagenta:'#d670d6',brightCyan:'#29b8db',brightWhite:'#ffffff'},
 'visual-studio-light':{...studioLightAnsi,background:'#f5f5f5',foreground:'#1e1e1e',cursor:'#007acc',selectionBackground:'#c9def5'},
 'visual-studio-dark':{...studioDarkAnsi,background:'#1e1e1e',foreground:'#d4d4d4',cursor:'#ffffff',selectionBackground:'#264f78'},
 'visual-studio-blue':{...studioLightAnsi,background:'#ffffff',foreground:'#1e1e1e',cursor:'#007acc',selectionBackground:'#b8d7f4'},
 solarized:{background:'#002b36',foreground:'#93a1a1',cursor:'#b58900',selectionBackground:'#264b55'},
 'solarized-light':{background:'#fdf6e3',foreground:'#586e75',cursor:'#b58900',selectionBackground:'#eee8d5'},
 dracula:{background:'#282a36',foreground:'#f8f8f2',cursor:'#ff79c6',selectionBackground:'#44475a',black:'#21222c',red:'#ff5555',green:'#50fa7b',yellow:'#f1fa8c',blue:'#bd93f9',magenta:'#ff79c6',cyan:'#8be9fd',white:'#f8f8f2',brightBlack:'#6272a4',brightRed:'#ff6e6e',brightGreen:'#69ff94',brightYellow:'#ffffa5',brightBlue:'#d6acff',brightMagenta:'#ff92df',brightCyan:'#a4ffff',brightWhite:'#ffffff'},
 nord:{background:'#2e3440',foreground:'#eceff4',cursor:'#88c0d0',selectionBackground:'#434c5e',black:'#3b4252',red:'#bf616a',green:'#a3be8c',yellow:'#ebcb8b',blue:'#81a1c1',magenta:'#b48ead',cyan:'#88c0d0',white:'#e5e9f0',brightBlack:'#4c566a',brightRed:'#bf616a',brightGreen:'#a3be8c',brightYellow:'#ebcb8b',brightBlue:'#81a1c1',brightMagenta:'#b48ead',brightCyan:'#8fbcbb',brightWhite:'#eceff4'},
 gruvbox:{background:'#282828',foreground:'#ebdbb2',cursor:'#fabd2f',selectionBackground:'#504945',black:'#282828',red:'#cc241d',green:'#98971a',yellow:'#d79921',blue:'#458588',magenta:'#b16286',cyan:'#689d6a',white:'#a89984',brightBlack:'#928374',brightRed:'#fb4934',brightGreen:'#b8bb26',brightYellow:'#fabd2f',brightBlue:'#83a598',brightMagenta:'#d3869b',brightCyan:'#8ec07c',brightWhite:'#ebdbb2'},
 'one-dark':{background:'#282c34',foreground:'#abb2bf',cursor:'#61afef',selectionBackground:'#3e4451',black:'#282c34',red:'#e06c75',green:'#98c379',yellow:'#e5c07b',blue:'#61afef',magenta:'#c678dd',cyan:'#56b6c2',white:'#abb2bf',brightBlack:'#5c6370',brightRed:'#e06c75',brightGreen:'#98c379',brightYellow:'#e5c07b',brightBlue:'#61afef',brightMagenta:'#c678dd',brightCyan:'#56b6c2',brightWhite:'#ffffff'},
 'rose-pine':{background:'#191724',foreground:'#e0def4',cursor:'#c4a7e7',selectionBackground:'#403d52',black:'#26233a',red:'#eb6f92',green:'#9ccfd8',yellow:'#f6c177',blue:'#31748f',magenta:'#c4a7e7',cyan:'#ebbcba',white:'#e0def4',brightBlack:'#6e6a86',brightRed:'#eb6f92',brightGreen:'#9ccfd8',brightYellow:'#f6c177',brightBlue:'#31748f',brightMagenta:'#c4a7e7',brightCyan:'#ebbcba',brightWhite:'#ffffff'},
 coffee:{background:'#faf4ed',foreground:'#483d35',cursor:'#8b5735',selectionBackground:'#e4d4c4'},
 contrast:{background:'#000000',foreground:'#ffffff',cursor:'#00ffff',selectionBackground:'#444444'},
};
export const terminalThemeLabels:Record<TerminalPreferences['theme'],string>={hornet:'Hornet 深色',light:'浅色','github-light':'GitHub 浅色','github-dark':'GitHub 深色','vscode-light':'VS Code 浅色','vscode-dark':'VS Code 深色','visual-studio-light':'Visual Studio 浅色','visual-studio-dark':'Visual Studio 深色','visual-studio-blue':'Visual Studio 蓝色',solarized:'Solarized 深色','solarized-light':'Solarized 浅色',dracula:'Dracula',nord:'Nord',gruvbox:'Gruvbox','one-dark':'One Dark','rose-pine':'Rosé Pine',coffee:'暖色浅色',contrast:'高对比度'};
export function readTerminalPreferences(value:string|null){try{return terminalPreferencesSchema.parse(JSON.parse(value??''));}catch{return {...terminalDefaults};}}
function initial(){try{return readTerminalPreferences(localStorage.getItem('hornet.terminal.preferences.v1'));}catch{return {...terminalDefaults};}}
export const useTerminalPreferences=create<{value:TerminalPreferences;save:(value:TerminalPreferences)=>void}>(set=>({value:initial(),save:value=>{const parsed=terminalPreferencesSchema.parse(value);localStorage.setItem('hornet.terminal.preferences.v1',JSON.stringify(parsed));set({value:parsed});}}));

export const quickCommandSchema=z.object({id:z.string().uuid(),name:z.string().trim().min(1).max(80),text:z.string().min(1).max(8192).refine(v=>!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v),'命令不能包含终端控制字符。'),setId:z.string().min(1).max(80).optional(),description:z.string().max(2048).optional(),enter:z.boolean().optional(),appearance:quickCommandAppearanceSchema.optional()}).strict();
export type QuickCommand=z.infer<typeof quickCommandSchema>;
export function readQuickCommands(value:string|null):QuickCommand[]{try{return z.array(quickCommandSchema).max(100).parse(JSON.parse(value??''));}catch{return [];}}
export function saveQuickCommands(commands:QuickCommand[]){const parsed=z.array(quickCommandSchema).max(100).parse(commands);localStorage.setItem('hornet.terminal.commands.v1',JSON.stringify(parsed));}
export type TerminalAction={viewId:string;kind:'export'|'selectAll'|'clear'|'execute'|'copy'|'paste'|'reset'|'input';terminalId?:string;text?:string;enter?:boolean};
export function terminalAction(action:TerminalAction){window.dispatchEvent(new CustomEvent('hornet:terminal-action',{detail:action}));}
