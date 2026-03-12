import { useEffect, useMemo, useState } from 'react'
import './App.css'

const API_BASE = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000').replace(/\/$/, '')

const normalizeUrls = (text) => text.split('\n').map((line) => line.trim()).filter(Boolean)
const isValidHttpUrl = (value) => {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export default function App() {
  const [urls, setUrls] = useState('')
  const [topic, setTopic] = useState('')
  const [debug, setDebug] = useState(false)
  const [health, setHealth] = useState(null)
  const [healthError, setHealthError] = useState('')
  const [jobs, setJobs] = useState([])
  const [jobsError, setJobsError] = useState('')
  const [jobId, setJobId] = useState('')
  const [job, setJob] = useState(null)
  const [result, setResult] = useState(null)
  const [review, setReview] = useState(null)
  const [reviewLoading, setReviewLoading] = useState(false)
  const [reviewError, setReviewError] = useState('')
  const [reviewQuery, setReviewQuery] = useState('')
  const [actionError, setActionError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [htmlExport, setHtmlExport] = useState('')
  const [exportMessage, setExportMessage] = useState('')
  const [downloadMode, setDownloadMode] = useState('csv')
  const [downloadSheetTitle, setDownloadSheetTitle] = useState('')
  const [downloadSheetTab, setDownloadSheetTab] = useState('')
  const [downloadBusy, setDownloadBusy] = useState(false)
  const [generatorMode, setGeneratorMode] = useState('csv')
  const [generatorCsvFile, setGeneratorCsvFile] = useState(null)
  const [generatorSheetTitle, setGeneratorSheetTitle] = useState('')
  const [generatorSheetTab, setGeneratorSheetTab] = useState('')
  const [generatorBusy, setGeneratorBusy] = useState(false)

  const sourceUrls = useMemo(() => normalizeUrls(urls), [urls])
  const invalidUrls = useMemo(() => sourceUrls.filter((url) => !isValidHttpUrl(url)), [sourceUrls])
  const validUniqueUrls = useMemo(() => {
    const seen = new Set()
    return sourceUrls.filter((url) => {
      const key = url.toLowerCase()
      if (!isValidHttpUrl(url) || seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [sourceUrls])
  const filteredReviewItems = useMemo(() => {
    const q = reviewQuery.trim().toLowerCase()
    const items = review?.items || []
    if (!q) return items
    return items.filter((item) => `${item.question} ${item.answer} ${item.topic} ${item.source}`.toLowerCase().includes(q))
  }, [review, reviewQuery])

  const loadJobs = async () => {
    try {
      setJobsError('')
      const response = await fetch(`${API_BASE}/api/jobs`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setJobs(await response.json())
    } catch (error) {
      setJobsError(error instanceof Error ? error.message : 'Error carregant jobs')
    }
  }

  const loadReview = async (targetJobId) => {
    if (!targetJobId) return
    setReviewLoading(true)
    setReviewError('')
    try {
      const response = await fetch(`${API_BASE}/api/jobs/${targetJobId}/review`)
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.detail || `HTTP ${response.status}`)
      setReview(data)
    } catch (error) {
      setReview(null)
      setReviewError(error instanceof Error ? error.message : 'Error carregant revisio')
    } finally {
      setReviewLoading(false)
    }
  }

  useEffect(() => {
    const run = async () => {
      try {
        setHealth(await (await fetch(`${API_BASE}/health`)).json())
      } catch (error) {
        setHealthError(error instanceof Error ? error.message : 'Unknown error')
      }
      loadJobs()
    }
    run()
  }, [])

  useEffect(() => {
    const timer = window.setInterval(loadJobs, 5000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!jobId) return undefined
    let cancelled = false
    let timer = null
    const poll = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/jobs/${jobId}`)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = await response.json()
        if (cancelled) return
        setJob(data)
        if (data.status === 'done') {
          const res = await fetch(`${API_BASE}/api/jobs/${jobId}/result`)
          if (res.ok && !cancelled) setResult((await res.json()).result)
          if (!cancelled) await loadReview(jobId)
          return
        }
        if (data.status !== 'error') timer = window.setTimeout(poll, 1500)
      } catch (error) {
        if (!cancelled) setActionError(error instanceof Error ? error.message : 'Error loading job status')
      }
    }
    poll()
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [jobId])

  const startScrape = async () => {
    setActionError('')
    if (!validUniqueUrls.length) return setActionError('Afegeix almenys una URL valida.')
    if (invalidUrls.length) return setActionError('Hi ha URLs no valides.')
    setSubmitting(true)
    setResult(null)
    setReview(null)
    setHtmlExport('')
    setExportMessage('')
    try {
      const response = await fetch(`${API_BASE}/api/jobs/scrape`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sources: validUniqueUrls.map((url) => ({ url, topic: topic.trim() })), debug }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.detail || `HTTP ${response.status}`)
      setJobId(data.job_id)
      loadJobs()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'No s ha pogut iniciar el job')
    } finally {
      setSubmitting(false)
    }
  }

  const getStatusClass = (status) => (['done', 'error', 'running'].includes(status) ? status : 'queued')
  const selectJob = (nextJobId) => { setJobId(nextJobId); setResult(null); setReview(null); setHtmlExport(''); setExportMessage('') }
  const updateReviewItem = async (itemId, approved) => {
    const response = await fetch(`${API_BASE}/api/jobs/${jobId}/review/${itemId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approved }) })
    const data = await response.json().catch(() => null)
    if (!response.ok) return setReviewError(data?.detail || `HTTP ${response.status}`)
    setReview((prev) => {
      if (!prev) return prev
      const items = prev.items.map((item) => item.id === data.id ? data : item)
      const approvedItems = items.filter((item) => item.approved).length
      return { ...prev, items, approved_items: approvedItems, pending_items: items.length - approvedItems }
    })
  }
  const setAllReviewItems = async (approved) => {
    const response = await fetch(`${API_BASE}/api/jobs/${jobId}/review/all`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approved }) })
    if (response.ok) loadReview(jobId)
  }
  const generateHtmlFromApproved = async () => {
    const response = await fetch(`${API_BASE}/api/jobs/${jobId}/export/html`, { method: 'POST' })
    const data = await response.json().catch(() => null)
    if (!response.ok) return setExportMessage(data?.detail || `HTTP ${response.status}`)
    setHtmlExport(data.html_text || '')
    setExportMessage(`HTML generat amb ${data.approved_rows} FAQ(s) aprovades.`)
  }
  const exportReviewToSheets = async () => {
    if (!downloadSheetTitle.trim() || !downloadSheetTab.trim()) return setExportMessage('Indica el titol i la pestanya del Google Sheet.')
    setDownloadBusy(true)
    const response = await fetch(`${API_BASE}/api/jobs/${jobId}/export/sheets`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ spreadsheet_title: downloadSheetTitle.trim(), worksheet_name: downloadSheetTab.trim() }) })
    const data = await response.json().catch(() => null)
    setDownloadBusy(false)
    setExportMessage(response.ok ? `FAQs exportades a Google Sheets: ${data.spreadsheet_title} / ${data.worksheet_name}.` : (data?.detail || `HTTP ${response.status}`))
  }
  const generateHtmlFromExternalSource = async () => {
    const formData = new FormData()
    formData.append('input_mode', generatorMode)
    if (generatorMode === 'csv') {
      if (!generatorCsvFile) return setExportMessage('Selecciona un fitxer CSV.')
      formData.append('csv_file', generatorCsvFile)
    } else {
      if (!generatorSheetTitle.trim() || !generatorSheetTab.trim()) return setExportMessage('Indica el titol i la pestanya del Google Sheet.')
      formData.append('spreadsheet_title', generatorSheetTitle.trim())
      formData.append('worksheet_name', generatorSheetTab.trim())
    }
    setGeneratorBusy(true)
    const response = await fetch(`${API_BASE}/api/export/html-from-source`, { method: 'POST', body: formData })
    const data = await response.json().catch(() => null)
    setGeneratorBusy(false)
    if (!response.ok) return setExportMessage(data?.detail || `HTTP ${response.status}`)
    setHtmlExport(data.html_text || '')
    setExportMessage(`HTML generat des de ${generatorMode === 'csv' ? 'CSV' : 'Google Sheets'} amb ${data.approved_rows} FAQ(s) aprovades.`)
  }

  return (
    <main className="page"><section className="panel">
      <header className="topbar"><div><p className="eyebrow">Descarregador de FAQs</p><h1>UPC FAQ Scraper Web</h1></div><div className="topbar-nav"><button className="secondary" type="button" onClick={loadJobs}>Refrescar</button></div></header>
      <section className="hero"><div className="hero-copy"><p className="eyebrow">Mateixa funcionalitat que `Scraper`</p><h2>Scraping, revisio i exportacio a CSV o Google Sheets</h2><p>Despres de revisar les FAQs pots escollir la destinacio exactament com al projecte Python de referencia.</p></div><div className="hero-stats"><div className="stat-chip"><strong>{validUniqueUrls.length}</strong><span>URLs valides</span></div><div className="stat-chip"><strong>{jobs.filter((item) => item.status === 'done').length}</strong><span>Jobs completats</span></div><div className="stat-chip"><strong>{review?.approved_items ?? 0}</strong><span>Aprovades</span></div></div></section>
      <section className="overview-grid">
        <section className="card workspace">
          <h2>Descarrega FAQs</h2>
          <label className="field"><span>URLs (una per linia)</span><textarea rows={8} value={urls} onChange={(e) => setUrls(e.target.value)} placeholder="https://web.upc.edu/pagina-faqs" /></label>
          <div className="row two"><label className="field"><span>Tema</span><input type="text" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Admissions" /></label><label className="field check"><input type="checkbox" checked={debug} onChange={(e) => setDebug(e.target.checked)} /><span>Debug scraping</span></label></div>
          <p className="summary"><strong>{validUniqueUrls.length}</strong> URL(s) uniques i valides {invalidUrls.length > 0 && <span>| {invalidUrls.length} no valides</span>}</p>
          {actionError && <p className="error">{actionError}</p>}
          <div className="actions-row"><button onClick={startScrape} disabled={submitting || validUniqueUrls.length === 0}>{submitting ? 'Iniciant job...' : 'Iniciar scraping'}</button></div>
        </section>
        <section className="card info-card">
          <h2>Backend</h2><p className="mono">{API_BASE}</p>
          {health && <p>Estat: <span className={`status ${health.ok ? 'done' : 'error'}`}>{health.ok ? 'Disponible' : 'No disponible'}</span></p>}
          {health && <pre>{JSON.stringify(health, null, 2)}</pre>}
          {healthError && <p className="error">{healthError}</p>}
        </section>
        <section className="card">
          <div className="title-row"><h2>Jobs recents</h2><button className="secondary" onClick={loadJobs}>Refrescar</button></div>
          {jobsError && <p className="error">{jobsError}</p>}
          {!jobsError && jobs.length === 0 && <p>Encara no hi ha jobs.</p>}
          {jobs.length > 0 && <div className="jobs-list">{jobs.slice(0, 8).map((item) => <button key={item.job_id} type="button" className={`job-item ${jobId === item.job_id ? 'active' : ''}`} onClick={() => selectJob(item.job_id)}><span className={`status ${getStatusClass(item.status)}`}>{item.status}</span><span className="mono">{item.job_id.slice(0, 10)}...</span><span>{item.processed_sources}/{item.total_sources}</span></button>)}</div>}
        </section>
        <section className="card">
          <h2>Estat del job</h2>
          {!jobId && <p>Encara no hi ha cap job seleccionat.</p>}
          {jobId && <><p className="mono">Job ID: {jobId}</p>{job && <><div className="progress-wrap"><div className="progress-bar" style={{ width: `${Math.round((job.progress_ratio || 0) * 100)}%` }} /></div><div className="grid"><div><strong>Status:</strong> <span className={`status ${getStatusClass(job.status)}`}>{job.status}</span></div><div><strong>Progres:</strong> {Math.round((job.progress_ratio || 0) * 100)}%</div><div><strong>Processades:</strong> {job.processed_sources}/{job.total_sources}</div><div><strong>URL actual:</strong> {job.current_url || '-'}</div></div><h3>Logs</h3><pre>{(job.logs || []).join('\n') || 'Sense logs encara'}</pre></>}{result && <div className="grid"><div><strong>Durada:</strong> {result.duration_s}s</div><div><strong>Rows:</strong> {result.stats?.total_rows ?? 0}</div><div><strong>FAQs:</strong> {result.stats?.total_faqs ?? 0}</div><div><strong>Errors:</strong> {result.stats?.total_errors ?? 0}</div></div>}</>}
        </section>
      </section>
      {job?.status === 'done' && <section className="card">
        <div className="title-row"><h2>Revisio i exportacio</h2><div className="actions-row"><button className="secondary" onClick={() => setAllReviewItems(true)}>Aprovar totes</button><button className="secondary" onClick={() => setAllReviewItems(false)}>Desmarcar totes</button><button className="secondary" onClick={() => loadReview(jobId)}>Refrescar</button></div></div>
        <label className="field"><span>Cerca</span><input type="text" value={reviewQuery} onChange={(e) => setReviewQuery(e.target.value)} placeholder="Filtra per pregunta, resposta, URL o topic" /></label>
        {reviewLoading && <p>Carregant revisio...</p>}{reviewError && <p className="error">{reviewError}</p>}
        {review && <><p className="summary"><strong>Total:</strong> {review.total_items} | <strong>Aprovades:</strong> {review.approved_items} | <strong>Pendents:</strong> {review.pending_items}</p><div className="review-list">{filteredReviewItems.slice(0, 30).map((item) => <article key={item.id} className="review-item"><label className="review-top"><input type="checkbox" checked={item.approved} onChange={(e) => updateReviewItem(item.id, e.target.checked)} /><strong>{item.question}</strong></label><p className="review-answer">{item.answer}</p><p className="mono review-meta">{item.topic} | {item.source}</p></article>)}</div>{filteredReviewItems.length > 30 && <p>Mostrant 30 de {filteredReviewItems.length} resultats.</p>}
        <div className="section-banner"><div><p className="eyebrow">Sortida del descarregador</p><h2>Escull on descarregar les FAQs</h2><p>Replica la sortida del projecte `Scraper`: `CSV` o `Google Sheets`.</p></div></div>
        <div className="mode-switch"><button type="button" className={downloadMode === 'csv' ? 'mode-pill active' : 'mode-pill'} onClick={() => setDownloadMode('csv')}>CSV</button><button type="button" className={downloadMode === 'sheets_oauth' ? 'mode-pill active' : 'mode-pill'} onClick={() => setDownloadMode('sheets_oauth')}>Google Sheets</button></div>
        {downloadMode === 'csv' ? <div className="export-card"><p className="summary">Descarrega el fitxer de revisio en format CSV.</p><a className="button-link" href={`${API_BASE}/api/jobs/${jobId}/export/csv`} target="_blank" rel="noreferrer">Descarregar CSV</a></div> : <div className="export-card"><div className="row two"><label className="field"><span>Titol del Google Sheet</span><input type="text" value={downloadSheetTitle} onChange={(e) => setDownloadSheetTitle(e.target.value)} placeholder="FAQs UPC" /></label><label className="field"><span>Nom de la pestanya</span><input type="text" value={downloadSheetTab} onChange={(e) => setDownloadSheetTab(e.target.value)} placeholder="Revisio" /></label></div><button type="button" onClick={exportReviewToSheets} disabled={downloadBusy}>{downloadBusy ? 'Exportant...' : 'Exportar a Google Sheets'}</button></div>}
        <div className="actions-row"><button className="secondary" onClick={generateHtmlFromApproved}>Generar HTML de les aprovades</button></div>
        {exportMessage && <p className="summary">{exportMessage}</p>}{htmlExport && <pre>{htmlExport}</pre>}</>}
      </section>}
      <section className="card workspace">
        <h2>Generador HTML des de CSV o Google Sheets</h2>
        <div className="mode-switch"><button type="button" className={generatorMode === 'csv' ? 'mode-pill active' : 'mode-pill'} onClick={() => setGeneratorMode('csv')}>CSV</button><button type="button" className={generatorMode === 'sheets_oauth' ? 'mode-pill active' : 'mode-pill'} onClick={() => setGeneratorMode('sheets_oauth')}>Google Sheets</button></div>
        {generatorMode === 'csv' ? <label className="field"><span>Fitxer CSV</span><input type="file" accept=".csv,text/csv" onChange={(e) => setGeneratorCsvFile(e.target.files?.[0] || null)} /></label> : <div className="row two"><label className="field"><span>Titol del Google Sheet</span><input type="text" value={generatorSheetTitle} onChange={(e) => setGeneratorSheetTitle(e.target.value)} placeholder="FAQs UPC" /></label><label className="field"><span>Nom de la pestanya</span><input type="text" value={generatorSheetTab} onChange={(e) => setGeneratorSheetTab(e.target.value)} placeholder="Revisio" /></label></div>}
        <div className="actions-row"><button type="button" onClick={generateHtmlFromExternalSource} disabled={generatorBusy}>{generatorBusy ? 'Generant...' : 'Generar HTML'}</button></div>
      </section>
    </section></main>
  )
}
