import { Route } from '@solidjs/router'
import Home from '../pages/Home'
import Room from '../pages/Room'

export function Routes() {
  return (
    <>
      <Route path="/" component={Home} />
      <Route path="/room/:code" component={Room} />
    </>
  )
}
