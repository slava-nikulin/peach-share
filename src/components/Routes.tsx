import { Route } from '@solidjs/router'
import Home from '../pages/Home'
import { lazy } from 'solid-js'
const Room = lazy(() => import('../pages/Room'))

export function Routes() {
  return (
    <>
      <Route path="/" component={Home} />
      <Route path="/room/:id" component={Room} />
    </>
  )
}
