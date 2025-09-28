import './App.css'
import { Router } from '@solidjs/router'
import { RootLayout } from './components/RootLayout'
import { Routes } from './components/Routes'
import './config/firebase'

export default function App() {
  return (
    <Router root={RootLayout}>
      <Routes />
    </Router>
  )
}
