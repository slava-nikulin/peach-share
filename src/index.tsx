/* @refresh reload */
import process from 'process';
import { render } from 'solid-js/web';
import './index.css';
import { App } from './app/App.tsx';

if (!('process' in globalThis)) {
  (globalThis as typeof globalThis & { process: typeof process }).process = process;
}

const root: HTMLElement | null = document.getElementById('root');

if (!root) {
  throw new Error('Root element with id "root" was not found');
}

render(() => <App />, root);
