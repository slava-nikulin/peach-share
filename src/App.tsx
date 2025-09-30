import './App.css'
import { Router } from '@solidjs/router'
import { RootLayout } from './components/RootLayout'
import { Routes } from './components/Routes'
import './config/firebase'
import { HeaderActionsProvider } from './components/header-actions'

export default function App() {
  return (
    <HeaderActionsProvider>
      <Router root={RootLayout}>
        <Routes />
      </Router>
    </HeaderActionsProvider>
  )
}
