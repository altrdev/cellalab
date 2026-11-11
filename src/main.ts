import { mount } from 'svelte';
import App from './App.svelte';
import { restoreSaved, startAutosave } from './ui/persist';
import { initTheme } from './theme';
import './app.css';

initTheme();
restoreSaved();
startAutosave();
mount(App, { target: document.getElementById('app')! });
