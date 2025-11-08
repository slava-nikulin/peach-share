import './App.css';
import { Router } from '@solidjs/router';
import type { Component } from 'solid-js';
import { FirebaseCoreProvider } from './components/FirebaseCoreProvider';
import { NavActionsProvider } from './components/nav-actions';
import { RootLayout } from './components/RootLayout';
import { Routes } from './components/Routes';

export const App: Component = () => (
  <FirebaseCoreProvider>
    <NavActionsProvider>
      <Router root={RootLayout}>
        <Routes />
      </Router>
    </NavActionsProvider>
  </FirebaseCoreProvider>
);
