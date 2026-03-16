import { useEffect, useMemo, useState } from 'react'
import './App.css'
import upcRoundLogo from './assets/upc_logo.png'
import homeLogo from './assets/home_logo.png'
import faqsLogo from './assets/faqs1_logo.png'
import downloadLogo from './assets/download.png'
import htmlLogo from './assets/html-source-code.png'
import googleLogo from './assets/Google_logo.png'

const defaultApiBase = `${window.location.protocol}//${window.location.hostname}:8000`
const API_BASE = (import.meta.env.VITE_API_URL || defaultApiBase).replace(/\/$/, '')
const STORAGE_KEY = 'upc-faq-manager-state-v2'
const GOOGLE_SESSION_KEY = 'upc-google-session-id'

const defaultSources = [
  {
    id: crypto.randomUUID(),
    topic: 'Admissions',
    urls: [{ id: crypto.randomUUID(), value: '' }],
  },
]

const defaultState = {
  activeView: 'home',
  sources: defaultSources,
  debug: false,
  downloadSheetTitle: 'FAQs UPC',
  downloadWorksheetName: 'Tab1',
  generatorMode: 'csv',
  generatorSheetTitle: 'FAQs UPC',
  generatorSheetTab: 'Revisio',
  lastGeneratedCode: '',
  lastSelectedJobId: '',
}

function loadPersistedState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultState
    return { ...defaultState, ...JSON.parse(raw) }
  } catch {
    return defaultState
  }
}

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function extractUniqueSources(groups) {
  const seen = new Set()
  const valid = []
  const invalid = []

  for (const group of groups) {
    for (const row of group.urls) {
      const url = row.value.trim()
      if (!url) continue
      if (!isValidHttpUrl(url)) {
        invalid.push(url)
        continue
      }
      const key = `${group.topic.trim().toLowerCase()}|${url.toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      valid.push({ topic: group.topic.trim(), url })
    }
  }

  return { valid, invalid }
}

function getStatusClass(status) {
  return ['queued', 'running', 'done', 'error'].includes(status) ? status : 'queued'
}

function StatCard({ label, value }) {
  return (
    <div className="stat-card">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}

function getGoogleSessionId() {
  let current = window.localStorage.getItem(GOOGLE_SESSION_KEY)
  if (current) return current
  current = crypto.randomUUID()
  window.localStorage.setItem(GOOGLE_SESSION_KEY, current)
  return current
}

export default function App() {
  const persisted = useMemo(() => loadPersistedState(), [])
  const [activeView, setActiveView] = useState(persisted.activeView)
  const [sources, setSources] = useState(persisted.sources)
  const [debug, setDebug] = useState(persisted.debug)
  const [downloadSheetTitle, setDownloadSheetTitle] = useState(persisted.downloadSheetTitle)
  const [downloadWorksheetName, setDownloadWorksheetName] = useState(persisted.downloadWorksheetName)
  const [generatorMode, setGeneratorMode] = useState(persisted.generatorMode)
  const [generatorSheetTitle, setGeneratorSheetTitle] = useState(persisted.generatorSheetTitle)
  const [generatorSheetTab, setGeneratorSheetTab] = useState(persisted.generatorSheetTab)
  const [lastGeneratedCode, setLastGeneratedCode] = useState(persisted.lastGeneratedCode)
  const [selectedJobId, setSelectedJobId] = useState(persisted.lastSelectedJobId)

  const [generatorCsvFile, setGeneratorCsvFile] = useState(null)
  const [jobs, setJobs] = useState([])
  const [selectedJob, setSelectedJob] = useState(null)
  const [jobResult, setJobResult] = useState(null)
  const [health, setHealth] = useState(null)
  const [googleSession, setGoogleSession] = useState(null)
  const [driveItems, setDriveItems] = useState([])
  const [driveStack, setDriveStack] = useState([{ id: null, name: 'El meu Drive' }])
  const [driveBrowserOpen, setDriveBrowserOpen] = useState(false)
  const [driveBusy, setDriveBusy] = useState(false)
  const [selectedDriveSheet, setSelectedDriveSheet] = useState(null)
  const [selectedDriveWorksheets, setSelectedDriveWorksheets] = useState([])
  const [creatingNewSheet, setCreatingNewSheet] = useState(false)
  const [activityLogs, setActivityLogs] = useState([])

  const [processMessage, setProcessMessage] = useState('')
  const [processError, setProcessError] = useState('')
  const [exportMessage, setExportMessage] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [downloadBusy, setDownloadBusy] = useState(false)
  const [generatorBusy, setGeneratorBusy] = useState(false)
  const [googleBusy, setGoogleBusy] = useState(false)
  const [lastAutoExportedJobId, setLastAutoExportedJobId] = useState('')

  const { valid: validSources, invalid: invalidSources } = useMemo(() => extractUniqueSources(sources), [sources])

  async function apiFetch(url, options = {}) {
    const googleSessionId = getGoogleSessionId()
    return fetch(url, {
      credentials: 'include',
      ...options,
      headers: {
        'X-Google-Session-Id': googleSessionId,
        ...(options.headers || {}),
      },
    })
  }

  function appendActivityLog(message) {
    setActivityLogs((current) => [...current.slice(-59), `${new Date().toLocaleTimeString()} · ${message}`])
  }

  useEffect(() => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        activeView,
        sources,
        debug,
        downloadSheetTitle,
        downloadWorksheetName,
        generatorMode,
        generatorSheetTitle,
        generatorSheetTab,
        lastGeneratedCode,
        lastSelectedJobId: selectedJobId,
      }),
    )
  }, [
    activeView,
    sources,
    debug,
    downloadSheetTitle,
    downloadWorksheetName,
    generatorMode,
    generatorSheetTitle,
    generatorSheetTab,
    lastGeneratedCode,
    selectedJobId,
  ])

  async function loadJobs() {
    const response = await apiFetch(`${API_BASE}/api/jobs`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    setJobs(await response.json())
  }

  async function loadGoogleStatus() {
    const params = new URLSearchParams()
    const sessionResponse = await apiFetch(`${API_BASE}/api/google/session?${params.toString()}`)
    const sessionData = await sessionResponse.json().catch(() => null)
    if (!sessionResponse.ok) throw new Error(sessionData?.detail || `HTTP ${sessionResponse.status}`)
    setGoogleSession(sessionData)
  }

  async function loadDriveItems(parentId = null, reset = false) {
    setDriveBusy(true)
    try {
      const params = new URLSearchParams()
      if (parentId) params.set('parent_id', parentId)
      const response = await apiFetch(`${API_BASE}/api/google/drive/items?${params.toString()}`)
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.detail || `HTTP ${response.status}`)
      setDriveItems(data.items || [])
      if (reset) {
        setDriveStack([{ id: null, name: 'El meu Drive' }])
      }
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : 'No s’ha pogut carregar el Drive.')
    } finally {
      setDriveBusy(false)
    }
  }

  async function loadSpreadsheetWorksheets(spreadsheetId) {
    try {
      const params = new URLSearchParams({ spreadsheet_id: spreadsheetId })
      const response = await apiFetch(`${API_BASE}/api/google/spreadsheets/worksheets?${params.toString()}`)
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.detail || `HTTP ${response.status}`)
      const worksheetNames = data.worksheets || []
      setSelectedDriveWorksheets(worksheetNames)
      setDownloadWorksheetName(worksheetNames[0] || 'Tab1')
    } catch (error) {
      setSelectedDriveWorksheets([])
      setDownloadWorksheetName('Tab1')
      setExportMessage(error instanceof Error ? error.message : 'No s’han pogut carregar les pestanyes del Google Sheet.')
    }
  }

  async function openDriveBrowser() {
    setDriveBrowserOpen(true)
    setExportMessage('')
    await loadDriveItems(null, true)
  }

  async function openDriveFolder(item) {
    setDriveStack((current) => [...current, { id: item.id, name: item.name }])
    await loadDriveItems(item.id)
  }

  async function navigateDriveTo(index) {
    const nextStack = driveStack.slice(0, index + 1)
    setDriveStack(nextStack)
    const current = nextStack[nextStack.length - 1]
    await loadDriveItems(current.id)
  }

  function selectDriveSheet(item) {
    setDownloadSheetTitle(item.name)
    setGeneratorSheetTitle(item.name)
    setSelectedDriveSheet(item)
    setCreatingNewSheet(false)
    loadSpreadsheetWorksheets(item.id).catch(() => {})
    setExportMessage(`Google Sheet seleccionat: ${item.name}`)
    appendActivityLog(`Google Sheet seleccionat: ${item.name}`)
  }

  function startCreatingNewSheet() {
    setCreatingNewSheet(true)
    setDriveBrowserOpen(false)
    setSelectedDriveSheet(null)
    setSelectedDriveWorksheets([])
    setDownloadSheetTitle('')
    setDownloadWorksheetName('Tab1')
    appendActivityLog('Mode de creacio de nou Google Sheet activat')
  }

  function returnToDriveBrowser() {
    setCreatingNewSheet(false)
  }

  useEffect(() => {
    const run = async () => {
      try {
        const [healthResponse] = await Promise.all([
          apiFetch(`${API_BASE}/health`),
          loadJobs(),
          loadGoogleStatus(),
        ])
        setHealth(await healthResponse.json())
      } catch (error) {
        setProcessError(error instanceof Error ? error.message : 'No s’ha pogut carregar l’estat inicial.')
      }
    }
    run()
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const authStatus = params.get('google_auth')
    const authMessage = params.get('message')
    if (!authStatus) return

    loadGoogleStatus().catch(() => {})

    if (authStatus === 'success') {
      setExportMessage('Sessio de Google connectada correctament.')
    } else if (authMessage) {
      setExportMessage(`No s’ha pogut completar el login amb Google: ${decodeURIComponent(authMessage)}`)
    }

    params.delete('google_auth')
    params.delete('message')
    const nextQuery = params.toString()
    const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash}`
    window.history.replaceState({}, '', nextUrl)
  }, [])

  useEffect(() => {
    const handleGoogleAuthMessage = (event) => {
      if (event.data?.source !== 'google-oauth') return

      loadGoogleStatus().catch(() => {})

      if (event.data.status === 'success') {
        setExportMessage('Sessio de Google connectada correctament.')
      } else {
        setExportMessage(`No s’ha pogut completar el login amb Google: ${event.data.message || 'error desconegut'}`)
      }

      setGoogleBusy(false)
    }

    window.addEventListener('message', handleGoogleAuthMessage)
    return () => window.removeEventListener('message', handleGoogleAuthMessage)
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      loadJobs().catch(() => {})
    }, 5000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!selectedJobId) return undefined
    let cancelled = false
    let timer = null

    const poll = async () => {
      try {
        const response = await apiFetch(`${API_BASE}/api/jobs/${selectedJobId}`)
        const data = await response.json().catch(() => null)
        if (!response.ok) throw new Error(data?.detail || `HTTP ${response.status}`)
        if (cancelled) return
        setSelectedJob(data)

        if (data.status === 'done') {
          const resultResponse = await apiFetch(`${API_BASE}/api/jobs/${selectedJobId}/result`)
          const resultData = await resultResponse.json().catch(() => null)
          if (resultResponse.ok && !cancelled) setJobResult(resultData.result)
          return
        }

        if (data.status !== 'error') {
          timer = window.setTimeout(poll, 1500)
        }
      } catch (error) {
        if (!cancelled) setProcessError(error instanceof Error ? error.message : 'No s’ha pogut carregar el job.')
      }
    }

    poll()
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [selectedJobId])

  useEffect(() => {
    if (!selectedJobId || selectedJob?.status !== 'done') return
    if (!googleSession?.connected) return
    if (!downloadSheetTitle.trim()) return
    if (downloadBusy) return
    if (lastAutoExportedJobId === selectedJobId) return

    exportScrapeResult().catch(() => {})
  }, [selectedJobId, selectedJob?.status, googleSession?.connected, downloadSheetTitle, downloadBusy, lastAutoExportedJobId])

  function addTopic() {
    setSources((current) => [
      ...current,
      { id: crypto.randomUUID(), topic: '', urls: [{ id: crypto.randomUUID(), value: '' }] },
    ])
  }

  function updateTopic(id, field, value) {
    setSources((current) =>
      current.map((group) => {
        if (group.id !== id) return group
        if (field === 'topic') return { ...group, topic: value }
        return { ...group, urls: group.urls.map((url) => (url.id === field ? { ...url, value } : url)) }
      }),
    )
  }

  function addUrl(topicId) {
    setSources((current) =>
      current.map((group) =>
        group.id === topicId
          ? { ...group, urls: [...group.urls, { id: crypto.randomUUID(), value: '' }] }
          : group,
      ),
    )
  }

  function removeTopic(topicId) {
    setSources((current) => (current.length === 1 ? current : current.filter((group) => group.id !== topicId)))
  }

  function removeUrl(topicId, urlId) {
    setSources((current) =>
      current.map((group) => {
        if (group.id !== topicId) return group
        if (group.urls.length === 1) return { ...group, urls: [{ ...group.urls[0], value: '' }] }
        return { ...group, urls: group.urls.filter((url) => url.id !== urlId) }
      }),
    )
  }

  async function startScrape() {
    setProcessError('')
    setProcessMessage('')
    setExportMessage('')

    if (!validSources.length) {
      setProcessError('Afegeix almenys una URL vàlida abans d’executar el procés.')
      return
    }
    if (invalidSources.length) {
      setProcessError('Hi ha URLs no vàlides. Revisa-les abans de continuar.')
      return
    }

    setSubmitting(true)
    try {
      const response = await apiFetch(`${API_BASE}/api/jobs/scrape`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sources: validSources, debug }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.detail || `HTTP ${response.status}`)
      setSelectedJobId(data.job_id)
      setLastAutoExportedJobId('')
      setActivityLogs([])
      setSelectedJob(null)
      setJobResult(null)
      setProcessMessage('Procés iniciat. Quan acabi, si tens Google configurat, s’exportarà automàticament al Sheet seleccionat.')
      await loadJobs()
    } catch (error) {
      setProcessError(error instanceof Error ? error.message : 'No s’ha pogut iniciar el scraping.')
    } finally {
      setSubmitting(false)
    }
  }

  async function connectGoogle() {
    setGoogleBusy(true)
    setExportMessage('')
    try {
      const formData = new FormData()
      const response = await apiFetch(`${API_BASE}/api/google/connect`, { method: 'POST', body: formData })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.detail || `HTTP ${response.status}`)
      if (!data?.authorization_url) throw new Error('No s’ha rebut la URL d’autenticacio de Google.')

      const popup = window.open(data.authorization_url, '_blank', 'popup=yes,width=560,height=720')
      if (!popup) throw new Error('El navegador ha bloquejat la finestra de login de Google.')
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : 'No s’ha pogut iniciar la sessió Google.')
      setGoogleBusy(false)
    }
  }

  async function logoutGoogle() {
    setGoogleBusy(true)
    try {
      const formData = new FormData()
      const response = await apiFetch(`${API_BASE}/api/google/logout`, { method: 'POST', body: formData })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.detail || `HTTP ${response.status}`)
      setGoogleSession(data)
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : 'No s’ha pogut tancar la sessió Google.')
    } finally {
      setGoogleBusy(false)
    }
  }

  async function exportScrapeResult() {
    if (!selectedJobId) return
    setExportMessage('')

    if (!downloadSheetTitle.trim()) {
      setExportMessage('Indica el títol del Google Sheet.')
      appendActivityLog('Exportacio cancel·lada: falta el titol del Google Sheet')
      return
    }

    setDownloadBusy(true)
    appendActivityLog(`Exportant FAQs a Google Sheets: ${downloadSheetTitle.trim()} / ${creatingNewSheet ? 'Tab1' : (downloadWorksheetName.trim() || 'Tab1')}`)
    try {
      const response = await apiFetch(`${API_BASE}/api/jobs/${selectedJobId}/export/sheets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spreadsheet_title: downloadSheetTitle.trim(),
          spreadsheet_id: selectedDriveSheet?.id || undefined,
          worksheet_name: creatingNewSheet ? 'Tab1' : (downloadWorksheetName.trim() || 'Tab1'),
        }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.detail || `HTTP ${response.status}`)
      setExportMessage(`Resultat exportat a Google Sheets: ${data.spreadsheet_title} / ${data.worksheet_name}. Fes la revisió i marca Estat=Aprovat al full.`)
      appendActivityLog(`Exportacio completada: ${data.spreadsheet_title} / ${data.worksheet_name}`)
      setLastAutoExportedJobId(selectedJobId)
      await loadGoogleStatus()
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : 'No s’ha pogut exportar a Google Sheets.')
      appendActivityLog(`Error d'exportacio a Google Sheets: ${error instanceof Error ? error.message : 'desconegut'}`)
    } finally {
      setDownloadBusy(false)
    }
  }

  async function generateHtmlFromExternalSource() {
    setExportMessage('')
    const formData = new FormData()
    formData.append('input_mode', generatorMode)

    if (generatorMode === 'csv') {
      if (!generatorCsvFile) {
        setExportMessage('Selecciona un fitxer CSV revisat.')
        return
      }
      if (!generatorCsvFile.name.toLowerCase().endsWith('.csv')) {
        setExportMessage('El fitxer seleccionat ha de ser CSV.')
        return
      }
      formData.append('csv_file', generatorCsvFile)
    } else {
      if (!generatorSheetTitle.trim()) {
        setExportMessage('Indica el títol del Google Sheet.')
        return
      }
      formData.append('spreadsheet_title', generatorSheetTitle.trim())
      formData.append('worksheet_name', 'Tab1')
    }

    setGeneratorBusy(true)
    try {
      const response = await apiFetch(`${API_BASE}/api/export/html-from-source`, {
        method: 'POST',
        body: formData,
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.detail || `HTTP ${response.status}`)
      setLastGeneratedCode(data.html_text || '')
      setExportMessage(`HTML generat amb ${data.approved_rows} files aprovades i ${data.groups} grups.`)
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : 'No s’ha pogut generar el HTML.')
    } finally {
      setGeneratorBusy(false)
    }
  }

  async function copyGeneratedCode() {
    if (!lastGeneratedCode.trim()) {
      setExportMessage('Encara no hi ha cap codi generat.')
      return
    }
    try {
      await navigator.clipboard.writeText(lastGeneratedCode)
      setExportMessage('Codi HTML copiat al porta-retalls.')
    } catch {
      setExportMessage('No s’ha pogut copiar el codi.')
    }
  }

  const expectsAutoExport = Boolean(googleSession?.connected && downloadSheetTitle.trim())
  const scrapeProgressPercent = Math.round((selectedJob?.progress_ratio || 0) * 100)
  let progressPercent = scrapeProgressPercent

  if (selectedJob?.status === 'running' && expectsAutoExport) {
    progressPercent = Math.min(scrapeProgressPercent, 88)
  } else if (selectedJob?.status === 'done' && expectsAutoExport) {
    progressPercent = lastAutoExportedJobId === selectedJobId ? 100 : (downloadBusy ? 94 : 90)
  }

  const visibleLogs = [...(selectedJob?.logs || []), ...activityLogs]
  const approvedRows = lastGeneratedCode.trim() ? lastGeneratedCode.split('\n').filter(Boolean).length : 0
  return (
    <div className="site-shell">
      <main className="app-shell">
        <section className="hero-banner">
          <div className="hero-copy">
            <p className="hero-tag">Gestio interna de FAQs UPC</p>
            <h1>Eina de gestió de preguntes freqüents de la UPC</h1>
            <p className="hero-text">
              Captura contingut des de webs UPC, revisa’l amb un flux clar i genera el codi HTML final amb una
              aparenca coherent amb l’ecosistema institucional.
            </p>
            <div className="hero-actions">
              <button type="button" onClick={() => setActiveView('scrape')}>Descarregador de Preguntes Freqüents</button>
              <button type="button" className="secondary" onClick={() => setActiveView('export')}>Generador de codi font</button>
            </div>
          </div>

          <aside className="hero-aside">
            <img className="hero-roundel" src={upcRoundLogo} alt="UPC" />
            <div className="hero-note">Universitat publica</div>
            <div className="hero-note alt">R+D+I</div>
            <div className="hero-card">
              <span className="hero-kicker">Flux</span>
              <strong>Scraping + revisio + Genweb</strong>
              <p>Una interfície de treball amb llenguatge visual molt proper a UPC.</p>
            </div>
          </aside>
        </section>

        {processError && <p className="feedback error">{processError}</p>}
        {processMessage && <p className="feedback success">{processMessage}</p>}
        {exportMessage && <p className="feedback info">{exportMessage}</p>}

        {activeView === 'home' && (
          <section className="content-grid home-layout">
            <aside className="panel side-panel">
              <img className="panel-icon" src={homeLogo} alt="" aria-hidden="true" />
              <h3>Accesos rapids</h3>
              <div className="side-links">
                <button type="button" className="text-link" onClick={() => setActiveView('scrape')}>Ordre de descarrega</button>
                <button type="button" className="text-link" onClick={() => setActiveView('export')}>Generar HTML final</button>
                <button type="button" className="text-link" onClick={() => loadGoogleStatus(true)}>Consultar Google Sheets</button>
              </div>
            </aside>

            <article className="panel feature-panel">
              <div className="section-head">
                <div>
                  <p className="panel-kicker">Portada</p>
                  <h2>Flux complet de treball</h2>
                </div>
                <img className="section-illustration" src={faqsLogo} alt="" aria-hidden="true" />
              </div>
              <p>
                Aquesta aplicació manté el circuit complet: captura FAQs, revisió i aprovació amb Google Sheets, i publicació final a Genweb només amb les files marcades com a aprovades.
              </p>
              <div className="home-actions">
                <button type="button" onClick={() => setActiveView('scrape')}>Anar a Fonts i descàrrega</button>
                <button type="button" className="secondary" onClick={() => setActiveView('export')}>Anar a Exporta codi</button>
              </div>
            </article>
          </section>
        )}

        {activeView === 'scrape' && (
          <section className="content-grid scrape-layout">
            <aside className="panel side-panel">
              <img className="panel-icon google-badge" src={googleLogo} alt="" aria-hidden="true" />
              <p>
                Estat: <span className={`status ${googleSession?.connected ? 'done' : 'queued'}`}>{googleSession?.connected ? 'Connectada' : 'No connectada'}</span>
              </p>
              <div className="action-stack">
                <button
                  type="button"
                  onClick={googleSession?.connected ? logoutGoogle : connectGoogle}
                  disabled={googleBusy}
                >
                  {googleBusy ? (googleSession?.connected ? 'Tancant sessio...' : 'Connectant...') : (googleSession?.connected ? 'Tancar sessio' : 'Iniciar sessio amb Google')}
                </button>
              </div>
              {googleSession?.connected && (
                <div className="drive-browser-card">
                  {!creatingNewSheet ? (
                    <button type="button" className="secondary" onClick={() => (driveBrowserOpen ? setDriveBrowserOpen(false) : openDriveBrowser())} disabled={driveBusy}>
                      {driveBrowserOpen ? 'Tancar explorador' : 'Explorar Drive'}
                    </button>
                  ) : (
                    <button type="button" className="secondary" onClick={returnToDriveBrowser}>
                      Tornar a Explorar Drive
                    </button>
                  )}

                  <button type="button" className={creatingNewSheet ? 'nav-pill active' : 'nav-pill'} onClick={startCreatingNewSheet}>
                    Crear Nou Sheets
                  </button>

                  {creatingNewSheet ? (
                    <label className="field">
                      <span>Titol del nou Google Sheet</span>
                      <input type="text" value={downloadSheetTitle} onChange={(event) => setDownloadSheetTitle(event.target.value)} />
                    </label>
                  ) : (
                    <>
                      {selectedDriveSheet && (
                        <div className="selected-sheet-card">
                          <span className="drive-item-kind">Sheet seleccionat</span>
                          <strong>{selectedDriveSheet.name}</strong>
                          {selectedDriveWorksheets.length > 0 && (
                            <label className="field worksheet-picker">
                              <span>Pestanya</span>
                              <select value={downloadWorksheetName} onChange={(event) => setDownloadWorksheetName(event.target.value)}>
                                {selectedDriveWorksheets.map((worksheet) => (
                                  <option key={worksheet} value={worksheet}>
                                    {worksheet}
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}
                        </div>
                      )}

                      {driveBrowserOpen && (
                        <div className="drive-browser-body">
                          <div className="drive-breadcrumbs">
                            {driveStack.map((crumb, index) => (
                              <button key={`${crumb.id || 'root'}-${index}`} type="button" className="drive-crumb" onClick={() => navigateDriveTo(index)} disabled={driveBusy}>
                                {crumb.name}
                              </button>
                            ))}
                          </div>

                          <div className="drive-list">
                            {driveBusy ? (
                              <p className="muted">Carregant elements de Drive...</p>
                            ) : driveItems.length > 0 ? (
                              driveItems.map((item) => (
                                <button
                                  key={item.id}
                                  type="button"
                                  className={`drive-item ${item.kind} ${selectedDriveSheet?.id === item.id ? 'selected' : ''}`}
                                  onClick={() => (item.kind === 'folder' ? openDriveFolder(item) : selectDriveSheet(item))}
                                >
                                  <span className="drive-item-kind">{item.kind === 'folder' ? 'Carpeta' : 'Sheet'}</span>
                                  <strong>{item.name}</strong>
                                </button>
                              ))
                            ) : (
                              <p className="muted">No hi ha carpetes ni Google Sheets en aquesta ubicació.</p>
                            )}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </aside>

            <div className="main-stack">
              <article className="panel wide">
                <div className="section-head">
                  <div className="title-with-icon">
                    <div className="title-row-inline">
                      <img className="section-illustration" src={downloadLogo} alt="" aria-hidden="true" />
                      <h2>Fonts i descàrrega</h2>
                    </div>
                  </div>
                  <button type="button" className="secondary" onClick={addTopic}>Afegir topic</button>
                </div>

                <div className="topic-stack">
                  {sources.map((group, index) => (
                    <section key={group.id} className="topic-card">
                      <div className="topic-head">
                        <label className="field grow">
                          <span>Topic</span>
                          <input
                            type="text"
                            value={group.topic}
                            onChange={(event) => updateTopic(group.id, 'topic', event.target.value)}
                            placeholder={`Topic ${index + 1}`}
                          />
                        </label>
                        <button type="button" className="ghost" onClick={() => removeTopic(group.id)}>Eliminar topic</button>
                      </div>

                      {group.urls.map((url) => (
                        <div key={url.id} className="url-row">
                          <input
                            type="url"
                            value={url.value}
                            onChange={(event) => updateTopic(group.id, url.id, event.target.value)}
                            placeholder="https://web.upc.edu/pagina-faq"
                          />
                          <button type="button" className="ghost" onClick={() => removeUrl(group.id, url.id)}>Eliminar URL</button>
                        </div>
                      ))}

                      <button type="button" className="secondary" onClick={() => addUrl(group.id)}>Afegir URL</button>
                    </section>
                  ))}
                </div>

                <div className="config-grid">
                </div>

                <div className="action-bar">
                  <button type="button" onClick={startScrape} disabled={submitting}>{submitting ? 'Executant...' : 'Descarregar FAQs'}</button>
                  <p className="muted">{validSources.length} URLs valides {invalidSources.length > 0 ? `· ${invalidSources.length} no valides` : ''}</p>
                </div>
              </article>

              <article className="panel wide">
                <div className="progress-shell">
                  <div className="progress-bar"><span style={{ width: `${progressPercent}%` }} /></div>
                  <strong>{progressPercent}%</strong>
                </div>

                {jobResult && (
                  <div className="summary-grid">
                    <div>URLs processades: {jobResult.stats?.total_urls ?? 0}</div>
                    <div>FAQs trobades: {jobResult.stats?.total_faqs ?? 0}</div>
                    <div>Files generades: {jobResult.stats?.total_rows ?? 0}</div>
                    <div>Errors: {jobResult.stats?.total_errors ?? 0}</div>
                  </div>
                )}

                <pre>{visibleLogs.join('\n') || 'Sense logs encara.'}</pre>
              </article>
            </div>
          </section>
        )}

        {activeView === 'export' && (
          <section className="content-grid export-layout">
            <aside className="panel side-panel">
              <h3>Recordatori</h3>
              <p className="muted">Nomes s’utilitzen les files amb estat `Aprovat`.</p>
              <p className="muted">Si falta `Subtopic`, el sistema hi posara `-` per defecte.</p>
            </aside>

            <article className="panel">
              <div className="section-head">
                <div className="title-with-icon">
                  <div className="title-row-inline">
                    <img className="section-illustration" src={htmlLogo} alt="" aria-hidden="true" />
                    <h2>Exporta codi font per Genweb</h2>
                  </div>
                </div>
              </div>

              <p className="muted">Selecciona el CSV revisat o el Google Sheet on hagis marcat `Estat = Aprovat`.</p>

              <div className="toggle-row">
                <button type="button" className={generatorMode === 'csv' ? 'nav-pill active' : 'nav-pill'} onClick={() => setGeneratorMode('csv')}>CSV</button>
                <button type="button" className={generatorMode === 'sheets_oauth' ? 'nav-pill active' : 'nav-pill'} onClick={() => setGeneratorMode('sheets_oauth')}>Google Sheets</button>
              </div>

              {generatorMode === 'csv' ? (
                <label className="field">
                  <span>CSV revisat</span>
                  <input type="file" accept=".csv,text/csv" onChange={(event) => setGeneratorCsvFile(event.target.files?.[0] || null)} />
                </label>
              ) : (
                <label className="field">
                  <span>Titol del Google Sheet</span>
                  <input type="text" value={generatorSheetTitle} onChange={(event) => setGeneratorSheetTitle(event.target.value)} />
                </label>
              )}

              <div className="action-stack">
                <button type="button" onClick={generateHtmlFromExternalSource} disabled={generatorBusy}>{generatorBusy ? 'Generant...' : 'Generar codi font'}</button>
                <button type="button" className="secondary" onClick={copyGeneratedCode}>Copiar tot el codi</button>
              </div>
            </article>

            <article className="panel wide">
              <div className="section-head">
                <div>
                  <p className="panel-kicker">Sortida</p>
                  <h2>HTML final</h2>
                </div>
              </div>
              <pre className="code-block">{lastGeneratedCode || 'Encara no s’ha generat cap HTML.'}</pre>
              <p className="muted">Enganxa aquest codi en un bloc HTML de Genweb. El resultat ja ve agrupat i amb el comportament d’acordio.</p>
            </article>
          </section>
        )}

        <p className="home-footnote mono">Projecte de gestio de FAQs UPC amb React i FastAPI. Quan em passis els logos oficials, els integro al header per acostar-nos encara mes a la imatge real de la UPC.</p>
      </main>
    </div>
  )
}
