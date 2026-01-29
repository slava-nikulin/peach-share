import type { RouteDefinition } from '@solidjs/router';
import { type Component, lazy } from 'solid-js';
import { HomeNavBar } from '../ui/components/home/HomeNavBar';
import { Home } from '../ui/pages/Home';

const Room: Component = lazy(async () => {
  const module = await import('../ui/pages/Room');
  return { default: module.Room };
});

const RoomNavBar: Component = lazy(async () => {
  const module = await import('../ui/components/room/RoomNavBar');
  return { default: module.RoomNavBar };
});

type RouteInfo = { navBar?: Component };

export const routes: RouteDefinition[] = [
  {
    path: '/',
    component: Home,
    info: { navBar: HomeNavBar } satisfies RouteInfo,
  },
  {
    path: '/room/:id',
    component: Room,
    info: { navBar: RoomNavBar } satisfies RouteInfo,
  },
];
