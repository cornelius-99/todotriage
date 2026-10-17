import { render } from 'preact';
import { App } from './app.tsx';
import { bootGoogle } from './google.ts';
import { boot } from './store.ts';
import './styles.css';

void boot();
bootGoogle();
render(<App />, document.getElementById('app')!);
