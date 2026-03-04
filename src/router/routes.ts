import type { RouteDefinition } from '@solidjs/router';
import { type Component, lazy } from 'solid-js';
import { Home } from '../ui/pages/Home';
import { HomeNavBar } from '../ui/pages/home/components/HomeNavBar';
import type { AppRouteInfo } from './route-info';

const Room: Component = lazy(async () => {
  const module = await import('../ui/pages/Room');
  return { default: module.Room };
});

export const routes: RouteDefinition[] = [
  {
    path: '/',
    component: Home,
    info: { navBar: HomeNavBar } satisfies AppRouteInfo,
  },
  {
    path: '/room/:id',
    component: Room,
    info: { hideFooter: true } satisfies AppRouteInfo,
  },
];
