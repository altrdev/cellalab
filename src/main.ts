import { mount } from 'svelte';
import App from './App.svelte';
import { restoreSaved, startAutosave } from './ui/persist';
import './app.css';

restoreSaved();
startAutosave();
mount(App, { target: document.getElementById('app')! });
