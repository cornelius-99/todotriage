import { render } from 'preact';
import { App } from './app.tsx';
import { boot } from './store.ts';
import './styles.css';

void boot();
render(<App />, document.getElementById('app')!);
