import './App.css';
import { Router } from '@solidjs/router';
import type { Component } from 'solid-js';
import { routes } from '../router/routes';
import { RootLayout } from './RootLayout';

export const App: Component = () => (
  <Router base={import.meta.env.BASE_URL} root={RootLayout}>
    {routes}
  </Router>
);
