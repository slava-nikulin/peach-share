import { type FirebaseApp, getApps, initializeApp } from 'firebase/app';
import type { FirebaseAppInit } from './types';

export function getOrInitApp(init: FirebaseAppInit): FirebaseApp {
  const existing = getApps().find((a) => a.name === init.name);
  return existing ?? initializeApp(init.options, init.name);
}
