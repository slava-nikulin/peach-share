import './App.css';
import { Router } from '@solidjs/router';
import type { Component } from 'solid-js';
import { NavActionsProvider } from './components/nav-actions';
import { RootLayout } from './components/RootLayout';
import { Routes } from './components/Routes';
// import './config/firebase'

export const App: Component = () => (
  <NavActionsProvider>
    <Router root={RootLayout}>
      <Routes />
    </Router>
  </NavActionsProvider>
);
