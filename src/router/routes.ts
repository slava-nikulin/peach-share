import type { RouteDefinition } from '@solidjs/router';
import { type Component, lazy } from 'solid-js';
import { Home } from '../ui/pages/Home';
import { HomeNavBar } from '../ui/pages/home/components/HomeNavBar';

const Room: Component = lazy(async () => {
  const module = await import('../ui/pages/Room');
  return { default: module.Room };
});

// const RoomNavBar: Component = lazy(async () => {
//   const module = await import('../ui/pages/room/components/RoomNavBar');
//   return { default: module.RoomNavBar };
// });

interface RouteInfo {
  navBar?: Component;
}

export const routes: RouteDefinition[] = [
  {
    path: '/',
    component: Home,
    info: { navBar: HomeNavBar } satisfies RouteInfo,
  },
  {
    path: '/room/:id',
    component: Room,
    // info: { navBar: RoomNavBar } satisfies RouteInfo,
  },
];
