import './App.css'
import { Router } from '@solidjs/router'
import { RootLayout } from './components/RootLayout'
import { Routes } from './components/Routes'
import { initializeApp } from 'firebase/app'
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check'

export default function App() {
  // Your Firebase configuration object
  const firebaseConfig = {
    apiKey: 'AIzaSyAYAsIcROqmXTInZh69Dx34tEtGrGq-syo',
    authDomain: 'peach-share.firebaseapp.com',
    databaseURL:
      'https://peach-share-default-rtdb.europe-west1.firebasedatabase.app',
    projectId: 'peach-share',
    storageBucket: 'peach-share.firebasestorage.app',
    messagingSenderId: '92172016413',
    appId: '1:92172016413:web:c98e6aa702c1e5b0c3dff4',
  }

  // Initialize Firebase
  const app = initializeApp(firebaseConfig)

  // Initialize App Check with reCAPTCHA v3
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(
      '6LdkCdYrAAAAAP8Hb0Iu6xz56oIYmkZ9_YkbPk9e'
    ),
    isTokenAutoRefreshEnabled: true, // Optional: Automatically refreshes tokens
  })

  return (
    <Router root={RootLayout}>
      <Routes />
    </Router>
  )
}
