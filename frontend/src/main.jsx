import { Component, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

class AppErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, asyncError: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('React render error:', error, info)
  }

  componentDidMount() {
    this.handleWindowError = (event) => {
      const message = event?.error?.message || event?.message || 'Error de runtime desconegut'
      this.setState({ asyncError: message })
    }
    this.handleUnhandledRejection = (event) => {
      const reason = event?.reason
      const message = reason instanceof Error ? reason.message : `${reason || 'Promise rejection desconeguda'}`
      this.setState({ asyncError: message })
    }
    window.addEventListener('error', this.handleWindowError)
    window.addEventListener('unhandledrejection', this.handleUnhandledRejection)
  }

  componentWillUnmount() {
    window.removeEventListener('error', this.handleWindowError)
    window.removeEventListener('unhandledrejection', this.handleUnhandledRejection)
  }

  render() {
    const { error, asyncError } = this.state
    if (error || asyncError) {
      const message = error?.message || asyncError || 'Error desconegut'
      return (
        <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
          <h2 style={{ marginTop: 0 }}>S'ha detectat un error a la UI</h2>
          <p style={{ marginBottom: '8px' }}>Missatge:</p>
          <pre style={{ whiteSpace: 'pre-wrap', background: '#fff5f5', border: '1px solid #f0b5b5', padding: '12px' }}>{message}</pre>
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
)
