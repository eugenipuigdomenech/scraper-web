import { useEffect, useMemo, useState } from 'react'
import './App.css'
import upcRoundLogo from './assets/upc_logo.png'
import homeLogo from './assets/home_logo.png'
import faqsLogo from './assets/faqs1_logo.png'
import downloadLogo from './assets/download.png'
import htmlLogo from './assets/html-source-code.png'
import googleLogo from './assets/Google_logo.png'

const API_BASE = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000').replace(/\/$/, '')
const STORAGE_KEY = 'upc-faq-manager-state-v2'

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
  downloadMode: 'csv',
  downloadCsvFilename: 'faqs-upc.csv',
  downloadSheetTitle: 'FAQs UPC',
  downloadSheetTab: 'Revisio',
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

export default function App() {
  const persisted = useMemo(() => loadPersistedState(), [])
  const [activeView, setActiveView] = useState(persisted.activeView)
  const [sources, setSources] = useState(persisted.sources)
  const [debug, setDebug] = useState(persisted.debug)
  const [downloadMode, setDownloadMode] = useState(persisted.downloadMode)
  const [downloadCsvFilename, setDownloadCsvFilename] = useState(persisted.downloadCsvFilename)
  const [downloadSheetTitle, setDownloadSheetTitle] = useState(persisted.downloadSheetTitle)
  const [downloadSheetTab, setDownloadSheetTab] = useState(persisted.downloadSheetTab)
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
  const [googleSheets, setGoogleSheets] = useState([])
  const [showFullLog, setShowFullLog] = useState(false)

  const [processMessage, setProcessMessage] = useState('')
  const [processError, setProcessError] = useState('')
  const [exportMessage, setExportMessage] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [downloadBusy, setDownloadBusy] = useState(false)
  const [generatorBusy, setGeneratorBusy] = useState(false)
  const [googleBusy, setGoogleBusy] = useState(false)

  const { valid: validSources, invalid: invalidSources } = useMemo(() => extractUniqueSources(sources), [sources])

  useEffect(() => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        activeView,
        sources,
        debug,
        downloadMode,
        downloadCsvFilename,
        downloadSheetTitle,
        downloadSheetTab,
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
    downloadMode,
    downloadCsvFilename,
    downloadSheetTitle,
    downloadSheetTab,
    generatorMode,
    generatorSheetTitle,
    generatorSheetTab,
    lastGeneratedCode,
    selectedJobId,
  ])

  async function loadJobs() {
    const response = await fetch(`${API_BASE}/api/jobs`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    setJobs(await response.json())
  }

  async function loadGoogleStatus(withSheets = false) {
    const params = new URLSearchParams()
    const sessionResponse = await fetch(`${API_BASE}/api/google/session?${params.toString()}`)
    const sessionData = await sessionResponse.json().catch(() => null)
    if (!sessionResponse.ok) throw new Error(sessionData?.detail || `HTTP ${sessionResponse.status}`)
    setGoogleSession(sessionData)

    if (withSheets && sessionData.connected) {
      const sheetParams = new URLSearchParams()
      const sheetsResponse = await fetch(`${API_BASE}/api/google/spreadsheets?${sheetParams.toString()}`)
      const sheetsData = await sheetsResponse.json().catch(() => null)
      if (!sheetsResponse.ok) throw new Error(sheetsData?.detail || `HTTP ${sheetsResponse.status}`)
      setGoogleSheets(sheetsData.spreadsheets || [])
    }
  }

  useEffect(() => {
    const run = async () => {
      try {
        const [healthResponse] = await Promise.all([
          fetch(`${API_BASE}/health`),
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
        const response = await fetch(`${API_BASE}/api/jobs/${selectedJobId}`)
        const data = await response.json().catch(() => null)
        if (!response.ok) throw new Error(data?.detail || `HTTP ${response.status}`)
        if (cancelled) return
        setSelectedJob(data)

        if (data.status === 'done') {
          const resultResponse = await fetch(`${API_BASE}/api/jobs/${selectedJobId}/result`)
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
      const response = await fetch(`${API_BASE}/api/jobs/scrape`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sources: validSources, debug }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.detail || `HTTP ${response.status}`)
      setSelectedJobId(data.job_id)
      setSelectedJob(null)
      setJobResult(null)
      setProcessMessage('Procés iniciat. Quan acabi, exporta el resultat a CSV o Google Sheets per fer la revisió i aprovació.')
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
      const response = await fetch(`${API_BASE}/api/google/connect`, { method: 'POST', body: formData })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.detail || `HTTP ${response.status}`)
      setGoogleSession(data)
      await loadGoogleStatus(true)
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : 'No s’ha pogut iniciar la sessió Google.')
    } finally {
      setGoogleBusy(false)
    }
  }

  async function logoutGoogle() {
    setGoogleBusy(true)
    try {
      const formData = new FormData()
      const response = await fetch(`${API_BASE}/api/google/logout`, { method: 'POST', body: formData })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.detail || `HTTP ${response.status}`)
      setGoogleSession(data)
      setGoogleSheets([])
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : 'No s’ha pogut tancar la sessió Google.')
    } finally {
      setGoogleBusy(false)
    }
  }

  async function exportScrapeResult() {
    if (!selectedJobId) return
    setExportMessage('')

    if (downloadMode === 'csv') {
      const filename = downloadCsvFilename.trim()
      if (!filename.toLowerCase().endsWith('.csv')) {
        setExportMessage('El nom del fitxer CSV ha d’acabar amb .csv.')
        return
      }
      window.open(`${API_BASE}/api/jobs/${selectedJobId}/export/csv?filename=${encodeURIComponent(filename)}`, '_blank')
      return
    }

    if (!downloadSheetTitle.trim() || !downloadSheetTab.trim()) {
      setExportMessage('Indica el títol i el nom de la pestanya del Google Sheet.')
      return
    }

    setDownloadBusy(true)
    try {
      const response = await fetch(`${API_BASE}/api/jobs/${selectedJobId}/export/sheets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spreadsheet_title: downloadSheetTitle.trim(),
          worksheet_name: downloadSheetTab.trim(),
        }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.detail || `HTTP ${response.status}`)
      setExportMessage(`Resultat exportat a Google Sheets: ${data.spreadsheet_title} / ${data.worksheet_name}. Fes la revisió i marca Estat=Aprovat al full.`)
      await loadGoogleStatus(true)
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : 'No s’ha pogut exportar a Google Sheets.')
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
      if (!generatorSheetTitle.trim() || !generatorSheetTab.trim()) {
        setExportMessage('Indica el títol i la pestanya del Google Sheet.')
        return
      }
      formData.append('spreadsheet_title', generatorSheetTitle.trim())
      formData.append('worksheet_name', generatorSheetTab.trim())
    }

    setGeneratorBusy(true)
    try {
      const response = await fetch(`${API_BASE}/api/export/html-from-source`, {
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

  const progressPercent = Math.round((selectedJob?.progress_ratio || 0) * 100)
  const visibleLogs = showFullLog ? selectedJob?.logs || [] : (selectedJob?.logs || []).slice(-8)
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
                Aquesta aplicació manté el circuit complet: captura FAQs, revisió i aprovació fora de la UI principal via CSV o
                Google Sheets, i publicació final a Genweb només amb les files marcades com a aprovades.
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
              <h3>Serveis</h3>
              <p className="muted">Configura l’accés a Google i reaprofita els fulls disponibles.</p>
              <p>
                Estat: <span className={`status ${googleSession?.connected ? 'done' : 'queued'}`}>{googleSession?.connected ? 'Connectada' : 'No connectada'}</span>
              </p>
              <p className="muted">Configuracio OAuth backend: {googleSession?.oauth_client_json || 'pendent'}</p>
              {googleSession?.oauth_client_found === false && <p className="feedback error">No s’ha trobat el fitxer OAuth indicat. Posa la ruta correcta o copia `oauth_client.json` al projecte.</p>}
              <div className="action-stack">
                <button type="button" onClick={connectGoogle} disabled={googleBusy}>{googleBusy ? 'Connectant...' : 'Iniciar sessio amb Google'}</button>
                <button type="button" className="secondary" onClick={() => loadGoogleStatus(true)} disabled={googleBusy}>Examinar Sheets</button>
                <button type="button" className="secondary" onClick={logoutGoogle} disabled={googleBusy}>Tancar sessio</button>
              </div>
              {googleSheets.length > 0 && (
                <div className="sheet-list">
                  {googleSheets.slice(0, 8).map((sheet) => (
                    <button
                      key={sheet}
                      type="button"
                      className="sheet-pill"
                      onClick={() => {
                        setDownloadSheetTitle(sheet)
                        setGeneratorSheetTitle(sheet)
                      }}
                    >
                      {sheet}
                    </button>
                  ))}
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
                  <label className="field">
                    <span>Sortida de revisio</span>
                    <div className="toggle-row">
                      <button type="button" className={downloadMode === 'csv' ? 'nav-pill active' : 'nav-pill'} onClick={() => setDownloadMode('csv')}>CSV</button>
                      <button type="button" className={downloadMode === 'sheets' ? 'nav-pill active' : 'nav-pill'} onClick={() => setDownloadMode('sheets')}>Google Sheets</button>
                    </div>
                  </label>

                  {downloadMode === 'csv' ? (
                    <label className="field">
                      <span>Nom del fitxer CSV</span>
                      <input type="text" value={downloadCsvFilename} onChange={(event) => setDownloadCsvFilename(event.target.value)} />
                    </label>
                  ) : (
                    <>
                      <label className="field">
                        <span>Titol del Google Sheet</span>
                        <input type="text" value={downloadSheetTitle} onChange={(event) => setDownloadSheetTitle(event.target.value)} />
                      </label>
                      <label className="field">
                        <span>Nom de la pestanya</span>
                        <input type="text" value={downloadSheetTab} onChange={(event) => setDownloadSheetTab(event.target.value)} />
                      </label>
                    </>
                  )}
                </div>

                <div className="action-bar">
                  <button type="button" onClick={startScrape} disabled={submitting}>{submitting ? 'Executant...' : 'Descarregar FAQs'}</button>
                  <p className="muted">{validSources.length} URLs valides {invalidSources.length > 0 ? `· ${invalidSources.length} no valides` : ''}</p>
                </div>
              </article>

              <article className="panel wide">
                <div className="section-head">
                  <div>
                    <p className="panel-kicker">Seguiment</p>
                    <h2>Execucio i revisio</h2>
                    <p className="muted">Quan acabi la captura, exporta el resultat a CSV o Google Sheets. La revisio i aprovacio es fan alli marcant `Estat = Aprovat`.</p>
                  </div>
                  <button type="button" className="secondary" onClick={() => setShowFullLog((current) => !current)}>
                    {showFullLog ? 'Amagar detalls' : 'Veure mes detalls'}
                  </button>
                </div>

                <div className="progress-shell">
                  <div className="progress-bar"><span style={{ width: `${progressPercent}%` }} /></div>
                  <strong>{progressPercent}%</strong>
                </div>

                <div className="summary-grid">
                  <div><span className={`status ${getStatusClass(selectedJob?.status || 'queued')}`}>{selectedJob?.status || 'sense job'}</span></div>
                  <div>URL actual: {selectedJob?.current_url || '-'}</div>
                  <div>Processades: {selectedJob?.processed_sources || 0}/{selectedJob?.total_sources || 0}</div>
                  <div>Temps total: {jobResult?.duration_s ? `${jobResult.duration_s}s` : '-'}</div>
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

                <div className="action-stack">
                  <button type="button" onClick={exportScrapeResult} disabled={!selectedJobId || downloadBusy}>
                    {downloadBusy ? 'Exportant...' : 'Exportar per revisar'}
                  </button>
                  <button type="button" className="secondary" onClick={() => setActiveView('export')}>
                    Anar a Exporta codi
                  </button>
                </div>
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
                <>
                  <label className="field">
                    <span>Titol del Google Sheet</span>
                    <input type="text" value={generatorSheetTitle} onChange={(event) => setGeneratorSheetTitle(event.target.value)} />
                  </label>
                  <label className="field">
                    <span>Nom de la pestanya</span>
                    <input type="text" value={generatorSheetTab} onChange={(event) => setGeneratorSheetTab(event.target.value)} />
                  </label>
                </>
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
