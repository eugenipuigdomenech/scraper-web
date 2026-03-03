import { useEffect, useMemo, useState } from 'react'
import './App.css'

const API_BASE = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000').replace(/\/$/, '')

function normalizeUrls(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function App() {
  const [urls, setUrls] = useState('')
  const [topic, setTopic] = useState('')
  const [debug, setDebug] = useState(false)

  const [health, setHealth] = useState(null)
  const [healthError, setHealthError] = useState('')

  const [jobId, setJobId] = useState('')
  const [job, setJob] = useState(null)
  const [result, setResult] = useState(null)
  const [jobs, setJobs] = useState([])
  const [jobsError, setJobsError] = useState('')

  const [actionError, setActionError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [review, setReview] = useState(null)
  const [reviewLoading, setReviewLoading] = useState(false)
  const [reviewError, setReviewError] = useState('')
  const [reviewQuery, setReviewQuery] = useState('')
  const [htmlExport, setHtmlExport] = useState('')
  const [exportMessage, setExportMessage] = useState('')

  const sourceUrls = useMemo(() => normalizeUrls(urls), [urls])
  const normalizedUrlMap = useMemo(() => {
    return sourceUrls.reduce((acc, url) => {
      const key = url.toLowerCase()
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {})
  }, [sourceUrls])
  const invalidUrls = useMemo(() => sourceUrls.filter((url) => !isValidHttpUrl(url)), [sourceUrls])
  const duplicateUrls = useMemo(() => {
    return Object.entries(normalizedUrlMap)
      .filter(([, count]) => count > 1)
      .map(([url]) => url)
  }, [normalizedUrlMap])
  const validUniqueUrls = useMemo(() => {
    const seen = new Set()
    return sourceUrls.filter((url) => {
      if (!isValidHttpUrl(url)) return false
      const key = url.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [sourceUrls])
  const filteredReviewItems = useMemo(() => {
    const items = review?.items || []
    const query = reviewQuery.trim().toLowerCase()
    if (!query) return items
    return items.filter((item) => {
      const blob = `${item.question} ${item.answer} ${item.source} ${item.topic}`.toLowerCase()
      return blob.includes(query)
    })
  }, [review, reviewQuery])

  async function loadJobs() {
    try {
      setJobsError('')
      const response = await fetch(`${API_BASE}/api/jobs`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      setJobs(Array.isArray(data) ? data : [])
    } catch (error) {
      setJobsError(error instanceof Error ? error.message : 'Error carregant jobs')
    }
  }

  async function loadReview(targetJobId) {
    if (!targetJobId) return
    setReviewLoading(true)
    setReviewError('')
    try {
      const response = await fetch(`${API_BASE}/api/jobs/${targetJobId}/review`)
      if (!response.ok) {
        const err = await response.json().catch(() => null)
        throw new Error(err?.detail || `HTTP ${response.status}`)
      }
      const data = await response.json()
      setReview(data)
    } catch (error) {
      setReview(null)
      setReviewError(error instanceof Error ? error.message : 'Error carregant revisio')
    } finally {
      setReviewLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false

    async function runHealthCheck() {
      setHealthError('')
      try {
        const response = await fetch(`${API_BASE}/health`)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = await response.json()
        if (!cancelled) setHealth(data)
      } catch (error) {
        if (!cancelled) setHealthError(error instanceof Error ? error.message : 'Unknown error')
      }
    }

    runHealthCheck()
    loadJobs()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      loadJobs()
    }, 5000)

    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!jobId) return undefined

    let cancelled = false
    let timer = null

    async function loadJob() {
      try {
        const response = await fetch(`${API_BASE}/api/jobs/${jobId}`)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)

        const data = await response.json()
        if (cancelled) return
        setJob(data)

        if (data.status === 'done') {
          const resultResponse = await fetch(`${API_BASE}/api/jobs/${jobId}/result`)
          if (resultResponse.ok) {
            const resultData = await resultResponse.json()
            if (!cancelled) setResult(resultData.result)
          }
          if (!cancelled) await loadReview(jobId)
          loadJobs()
          return
        }

        if (data.status === 'error') {
          loadJobs()
          return
        }

        timer = window.setTimeout(loadJob, 1500)
      } catch (error) {
        if (!cancelled) {
          setActionError(error instanceof Error ? error.message : 'Error loading job status')
        }
      }
    }

    loadJob()

    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [jobId])

  async function startScrape() {
    setActionError('')

    if (sourceUrls.length === 0) {
      setActionError('Afegeix almenys una URL.')
      return
    }

    if (invalidUrls.length > 0) {
      setActionError('Hi ha URLs no valides. Revisa-les abans d\'iniciar.')
      return
    }

    if (validUniqueUrls.length === 0) {
      setActionError('No hi ha URLs valides per processar.')
      return
    }

    const sources = validUniqueUrls.map((url) => ({ url, topic: topic.trim() }))

    setSubmitting(true)
    setResult(null)
    setJob(null)
    setReview(null)
    setHtmlExport('')
    setExportMessage('')

    try {
      const response = await fetch(`${API_BASE}/api/jobs/scrape`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sources, debug }),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => null)
        throw new Error(err?.detail || `HTTP ${response.status}`)
      }

      const data = await response.json()
      setJobId(data.job_id)
      loadJobs()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'No s\'ha pogut iniciar el job')
    } finally {
      setSubmitting(false)
    }
  }

  function getStatusClass(status) {
    if (status === 'done') return 'done'
    if (status === 'error') return 'error'
    if (status === 'running') return 'running'
    return 'queued'
  }

  async function updateReviewItem(itemId, approved) {
    if (!jobId) return
    setReviewError('')
    try {
      const response = await fetch(`${API_BASE}/api/jobs/${jobId}/review/${itemId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved }),
      })
      if (!response.ok) {
        const err = await response.json().catch(() => null)
        throw new Error(err?.detail || `HTTP ${response.status}`)
      }
      const updated = await response.json()
      setReview((prev) => {
        if (!prev) return prev
        const items = (prev.items || []).map((item) => (item.id === updated.id ? updated : item))
        const approvedCount = items.filter((item) => item.approved).length
        return {
          ...prev,
          items,
          approved_items: approvedCount,
          pending_items: items.length - approvedCount,
        }
      })
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : 'Error actualitzant revisio')
    }
  }

  async function setAllReviewItems(approved) {
    if (!jobId) return
    setReviewError('')
    try {
      const response = await fetch(`${API_BASE}/api/jobs/${jobId}/review/all`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved }),
      })
      if (!response.ok) {
        const err = await response.json().catch(() => null)
        throw new Error(err?.detail || `HTTP ${response.status}`)
      }
      await loadReview(jobId)
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : 'Error actualitzant revisio')
    }
  }

  async function generateHtmlFromApproved() {
    if (!jobId) return
    setExportMessage('')
    try {
      const response = await fetch(`${API_BASE}/api/jobs/${jobId}/export/html`, {
        method: 'POST',
      })
      if (!response.ok) {
        const err = await response.json().catch(() => null)
        throw new Error(err?.detail || `HTTP ${response.status}`)
      }
      const data = await response.json()
      setHtmlExport(data.html_text || '')
      setExportMessage(`HTML generat amb ${data.approved_rows} FAQ(s) aprovades.`)
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : 'Error generant HTML')
    }
  }

  return (
    <main className="page">
      <section className="panel">
        <header className="head">
          <h1>UPC FAQ Scraper Web</h1>
          <p>Scraping en background amb FastAPI i seguiment de job en temps real.</p>
        </header>

        <section className="card">
          <h2>Configuracio</h2>

          <label className="field">
            <span>URLs (una per linia)</span>
            <textarea
              rows={8}
              value={urls}
              onChange={(e) => setUrls(e.target.value)}
              placeholder="https://web.upc.edu/pagina-faqs"
            />
          </label>

          <div className="row two">
            <label className="field">
              <span>Tema (s'aplica a totes les URLs)</span>
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Admissions"
              />
            </label>

            <label className="field check">
              <input type="checkbox" checked={debug} onChange={(e) => setDebug(e.target.checked)} />
              <span>Debug scraping</span>
            </label>
          </div>

          <div className="summary">
            <strong>{validUniqueUrls.length}</strong> URL(s) uniques i valides
            {duplicateUrls.length > 0 && <span> · {duplicateUrls.length} duplicades</span>}
            {invalidUrls.length > 0 && <span> · {invalidUrls.length} no valides</span>}
          </div>

          {invalidUrls.length > 0 && (
            <p className="warn">
              URLs no valides: {invalidUrls.slice(0, 3).join(', ')}
              {invalidUrls.length > 3 ? '...' : ''}
            </p>
          )}

          <button onClick={startScrape} disabled={submitting || validUniqueUrls.length === 0}>
            {submitting ? 'Iniciant job...' : 'Iniciar Scraping'}
          </button>

          {actionError && <p className="error">{actionError}</p>}
        </section>

        <section className="card">
          <h2>Backend</h2>
          <p className="mono">{API_BASE}</p>
          {health && (
            <p>
              Estat: <span className={`status ${health.ok ? 'done' : 'error'}`}>{health.ok ? 'Disponible' : 'No disponible'}</span>
            </p>
          )}
          {health && <pre>{JSON.stringify(health, null, 2)}</pre>}
          {healthError && <p className="error">{healthError}</p>}
        </section>

        <section className="card">
          <div className="title-row">
            <h2>Jobs recents</h2>
            <button className="secondary" onClick={loadJobs}>Refrescar</button>
          </div>
          {jobsError && <p className="error">{jobsError}</p>}
          {!jobsError && jobs.length === 0 && <p>Encara no hi ha jobs.</p>}
          {jobs.length > 0 && (
            <div className="jobs-list">
              {jobs.slice(0, 8).map((item) => (
                <button
                  key={item.job_id}
                  type="button"
                  className={`job-item ${jobId === item.job_id ? 'active' : ''}`}
                  onClick={() => {
                    setJobId(item.job_id)
                    setResult(null)
                    setReview(null)
                    setHtmlExport('')
                    setExportMessage('')
                    setActionError('')
                  }}
                >
                  <span className={`status ${getStatusClass(item.status)}`}>{item.status}</span>
                  <span className="mono">{item.job_id.slice(0, 10)}...</span>
                  <span>{item.processed_sources}/{item.total_sources}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <h2>Estat del Job</h2>
          {!jobId && <p>Encara no hi ha cap job iniciat.</p>}

          {jobId && (
            <>
              <p className="mono">Job ID: {jobId}</p>
              {job && (
                <>
                  <div className="progress-wrap">
                    <div
                      className="progress-bar"
                      style={{ width: `${Math.round((job.progress_ratio || 0) * 100)}%` }}
                    />
                  </div>
                  <div className="grid">
                    <div><strong>Status:</strong> <span className={`status ${getStatusClass(job.status)}`}>{job.status}</span></div>
                    <div><strong>Progres:</strong> {Math.round((job.progress_ratio || 0) * 100)}%</div>
                    <div><strong>Processades:</strong> {job.processed_sources}/{job.total_sources}</div>
                    <div><strong>URL actual:</strong> {job.current_url || '-'}</div>
                  </div>

                  {job.error && <p className="error">{job.error}</p>}

                  <h3>Logs</h3>
                  <pre>{(job.logs || []).join('\n') || 'Sense logs encara'}</pre>
                </>
              )}
            </>
          )}
        </section>

        {result && (
          <section className="card">
            <h2>Resultat</h2>
            <div className="grid">
              <div><strong>Durada:</strong> {result.duration_s}s</div>
              <div><strong>Rows:</strong> {result.stats?.total_rows ?? 0}</div>
              <div><strong>FAQs:</strong> {result.stats?.total_faqs ?? 0}</div>
              <div><strong>Errors:</strong> {result.stats?.total_errors ?? 0}</div>
            </div>

            <h3>Errors per URL</h3>
            <pre>{JSON.stringify(result.errors || [], null, 2)}</pre>

            <h3>Primeres 10 files</h3>
            <pre>{JSON.stringify((result.rows || []).slice(0, 10), null, 2)}</pre>
          </section>
        )}

        {job && job.status === 'done' && (
          <section className="card">
            <div className="title-row">
              <h2>Revisio i aprovacio</h2>
              <div className="actions-row">
                <button className="secondary" onClick={() => setAllReviewItems(true)}>Aprovar totes</button>
                <button className="secondary" onClick={() => setAllReviewItems(false)}>Desmarcar totes</button>
                <button className="secondary" onClick={() => loadReview(jobId)}>Refrescar</button>
              </div>
            </div>

            <label className="field">
              <span>Cerca</span>
              <input
                type="text"
                value={reviewQuery}
                onChange={(e) => setReviewQuery(e.target.value)}
                placeholder="Filtra per pregunta, resposta, URL o topic"
              />
            </label>

            {reviewLoading && <p>Carregant revisio...</p>}
            {reviewError && <p className="error">{reviewError}</p>}

            {review && (
              <>
                <p>
                  <strong>Total:</strong> {review.total_items} · <strong>Aprovades:</strong> {review.approved_items} · <strong>Pendents:</strong> {review.pending_items}
                </p>

                <div className="review-list">
                  {filteredReviewItems.slice(0, 30).map((item) => (
                    <article key={item.id} className="review-item">
                      <label className="review-top">
                        <input
                          type="checkbox"
                          checked={item.approved}
                          onChange={(e) => updateReviewItem(item.id, e.target.checked)}
                        />
                        <strong>{item.question}</strong>
                      </label>
                      <p className="review-answer">{item.answer}</p>
                      <p className="mono review-meta">{item.topic} · {item.source}</p>
                    </article>
                  ))}
                </div>
                {filteredReviewItems.length > 30 && <p>Mostrant 30 de {filteredReviewItems.length} resultats.</p>}

                <h3>Exportacio</h3>
                <div className="actions-row">
                  <button className="secondary" onClick={generateHtmlFromApproved}>Generar HTML (aprovades)</button>
                  <a className="button-link" href={`${API_BASE}/api/jobs/${jobId}/export/csv`} target="_blank" rel="noreferrer">
                    Descarregar CSV
                  </a>
                </div>
                {exportMessage && <p className="summary">{exportMessage}</p>}
                {htmlExport && <pre>{htmlExport}</pre>}
              </>
            )}
          </section>
        )}
      </section>
    </main>
  )
}

export default App
