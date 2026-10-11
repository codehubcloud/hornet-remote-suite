import { observeAppearance } from './appearance';
import './themes.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './style.css';
import '@xterm/xterm/css/xterm.css';
observeAppearance();
createRoot(document.getElementById('root')!).render(<App/>);
