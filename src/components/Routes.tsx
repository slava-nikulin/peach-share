import { Route } from '@solidjs/router'
import Home from '../pages/Home'

export function Routes() {
  return (
    <>
      <Route path="/" component={Home} />
    </>
  )
}
