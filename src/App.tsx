import './App.css'
import { Router } from '@solidjs/router'
import { RootLayout } from './components/RootLayout'
import { Routes } from './components/Routes'
import { NavActionsProvider } from './components/nav-actions'
// import './config/firebase'

export default function App() {
  return (
    <NavActionsProvider>
      <Router root={RootLayout}>
        <Routes />
      </Router>
    </NavActionsProvider>
  )
}
