import { Route } from '@solidjs/router';
import { type Component, lazy } from 'solid-js';
import { Home } from '../pages/Home';

const Room: Component = lazy(async () => {
  const module = await import('../pages/Room');
  return { default: module.Room };
});
export const Routes: Component = () => (
  <>
    <Route path="/" component={Home} />
    <Route path="/room/:id" component={Room} />
  </>
);
