import './App.css';
import { Router } from '@solidjs/router';
import type { Component } from 'solid-js';
import { RootLayout } from './RootLayout';
import { routes } from '../router/routes';

export const App: Component = () => <Router root={RootLayout}>{routes}</Router>;
