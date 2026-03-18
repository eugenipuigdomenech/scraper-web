import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { useRef } from 'react'
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
    urls: [{ id: crypto.randomUUID(), value: '', enabled: true }],
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

function createEmptySource() {
  return {
    id: crypto.randomUUID(),
    topic: '',
    urls: [{ id: crypto.randomUUID(), value: '', enabled: true }],
  }
}

function normalizeUrlRow(row) {
  if (typeof row === 'string') {
    return { id: crypto.randomUUID(), value: row, enabled: true }
  }

  return {
    id: typeof row?.id === 'string' && row.id ? row.id : crypto.randomUUID(),
    value: typeof row?.value === 'string' ? row.value : '',
    enabled: row?.enabled !== false,
  }
}

function normalizeSources(input) {
  if (!Array.isArray(input) || input.length === 0) return defaultSources

  const normalized = input.map((group) => ({
    id: typeof group?.id === 'string' && group.id ? group.id : crypto.randomUUID(),
    topic: typeof group?.topic === 'string' ? group.topic : '',
    urls:
      Array.isArray(group?.urls) && group.urls.length > 0
        ? group.urls.map(normalizeUrlRow)
        : [{ id: crypto.randomUUID(), value: '', enabled: true }],
  }))

  return normalized.length > 0 ? normalized : defaultSources
}

function escapeCsvCell(value) {
  const text = `${value ?? ''}`
  if (/[";\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

function parseConfigCsv(text) {
  const rows = []
  let current = ''
  let row = []
  let insideQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1]

    if (char === '"') {
      if (insideQuotes && next === '"') {
        current += '"'
        index += 1
      } else {
        insideQuotes = !insideQuotes
      }
      continue
    }

    if (char === ';' && !insideQuotes) {
      row.push(current)
      current = ''
      continue
    }

    if ((char === '\n' || char === '\r') && !insideQuotes) {
      if (char === '\r' && next === '\n') index += 1
      row.push(current)
      rows.push(row)
      row = []
      current = ''
      continue
    }

    current += char
  }

  if (current || row.length > 0) {
    row.push(current)
    rows.push(row)
  }

  if (rows.length === 0) return []

  const [header, ...dataRows] = rows
  const normalizedHeader = header.map((cell) => cell.trim().toLowerCase())
  const topicIndex = normalizedHeader.indexOf('topic')
  const urlIndex = normalizedHeader.indexOf('url')
  const enabledIndex = normalizedHeader.indexOf('enabled')

  if (topicIndex === -1 || urlIndex === -1 || enabledIndex === -1) {
    throw new Error('El CSV de configuracio ha de tenir les columnes topic, url i enabled.')
  }

  return dataRows
    .filter((cells) => cells.some((cell) => cell.trim() !== ''))
    .map((cells) => ({
      topic: (cells[topicIndex] || '').trim(),
      url: (cells[urlIndex] || '').trim(),
      enabled: !['false', '0', 'no', 'off'].includes(((cells[enabledIndex] || '').trim().toLowerCase())),
    }))
}

function getReadableError(error, fallbackMessage) {
  if (error instanceof TypeError && error.message === 'Failed to fetch') {
    return 'No s’ha pogut connectar amb el servidor. Revisa que el backend estigui en marxa.'
  }
  return error instanceof Error ? error.message : fallbackMessage
}

function loadPersistedState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultState
    const parsed = JSON.parse(raw)
    return { ...defaultState, ...parsed, sources: normalizeSources(parsed.sources) }
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
      if (row.enabled === false) continue
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

function getGoogleSessionId() {
  let current = window.localStorage.getItem(GOOGLE_SESSION_KEY)
  if (current) return current
  current = crypto.randomUUID()
  window.localStorage.setItem(GOOGLE_SESSION_KEY, current)
  return current
}

export default function App() {
  const persisted = useMemo(() => loadPersistedState(), [])
  const configImportInputRef = useRef(null)
  const [activeView, setActiveView] = useState(persisted.activeView)
  const [sources, setSources] = useState(persisted.sources)
  const [debug] = useState(persisted.debug)
  const [downloadSheetTitle, setDownloadSheetTitle] = useState(persisted.downloadSheetTitle)
  const [downloadWorksheetName, setDownloadWorksheetName] = useState(persisted.downloadWorksheetName)
  const [generatorMode, setGeneratorMode] = useState(persisted.generatorMode)
  const [generatorSheetTitle, setGeneratorSheetTitle] = useState(persisted.generatorSheetTitle)
  const [lastGeneratedCode, setLastGeneratedCode] = useState(persisted.lastGeneratedCode)
  const [selectedJobId, setSelectedJobId] = useState(persisted.lastSelectedJobId)

  const [generatorCsvFile, setGeneratorCsvFile] = useState(null)
  const [_JOBS, setJobs] = useState([])
  const [selectedJob, setSelectedJob] = useState(null)
  const [jobResult, setJobResult] = useState(null)
  const [_HEALTH, setHealth] = useState(null)
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
  const enabledSourceCount = useMemo(
    () => sources.reduce((sum, group) => sum + group.urls.filter((url) => url.enabled !== false && url.value.trim()).length, 0),
    [sources],
  )
  const disabledSourceCount = useMemo(
    () => sources.reduce((sum, group) => sum + group.urls.filter((url) => url.enabled === false).length, 0),
    [sources],
  )
  const googleProfileLabel = googleSession?.profile_name || googleSession?.profile_email || 'Sessio de Google'

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
    if (creatingNewSheet) {
      setCreatingNewSheet(false)
      setDownloadSheetTitle(selectedDriveSheet?.name || '')
      return
    }

    setCreatingNewSheet(true)
    setDriveBrowserOpen(false)
    setSelectedDriveSheet(null)
    setSelectedDriveWorksheets([])
    setDownloadSheetTitle('')
    setDownloadWorksheetName('Tab1')
    appendActivityLog('Mode de creacio de nou Google Sheet activat')
  }

  async function returnToDriveBrowser() {
    setCreatingNewSheet(false)
    setDriveBrowserOpen(true)
    setExportMessage('')
    await loadDriveItems(null, true)
  }

  useEffect(() => {
    const run = async () => {
      try {
        const healthResponse = await apiFetch(`${API_BASE}/health`)
        if (!healthResponse.ok) throw new Error(`HTTP ${healthResponse.status}`)
        setHealth(await healthResponse.json())
        setProcessError('')
      } catch (error) {
        setProcessError(getReadableError(error, 'No s’ha pogut carregar l’estat inicial.'))
      }

      loadJobs().catch(() => {})
      loadGoogleStatus().catch(() => {})
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
        setProcessError('')
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
        if (cancelled) return

        const message = getReadableError(error, 'No s’ha pogut carregar el job.')
        if (message === 'Job not found' || message === 'HTTP 404') {
          setSelectedJobId('')
          setSelectedJob(null)
          setJobResult(null)
          setLastAutoExportedJobId('')
          setProcessError('')
          return
        }

        setProcessError(message)
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
      createEmptySource(),
    ])
  }

  function updateTopic(id, field, value) {
    setSources((current) =>
      current.map((group) => {
        if (group.id !== id) return group
        if (field === 'topic') return { ...group, topic: value }
        return { ...group, urls: group.urls.map((url) => (url.id === field ? { ...url, ...value } : url)) }
      }),
    )
  }

  function addUrl(topicId) {
    setSources((current) =>
      current.map((group) =>
        group.id === topicId
          ? { ...group, urls: [...group.urls, { id: crypto.randomUUID(), value: '', enabled: true }] }
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
        if (group.urls.length === 1) return { ...group, urls: [{ ...group.urls[0], value: '', enabled: true }] }
        return { ...group, urls: group.urls.filter((url) => url.id !== urlId) }
      }),
    )
  }

  function exportConfigCsv() {
    const rows = ['topic;url;enabled']

    sources.forEach((group) => {
      group.urls.forEach((url) => {
        rows.push(
          [
            escapeCsvCell(group.topic.trim()),
            escapeCsvCell(url.value.trim()),
            escapeCsvCell(url.enabled === false ? 'false' : 'true'),
          ].join(';'),
        )
      })
    })

    const blob = new Blob([`\uFEFF${rows.join('\r\n')}`], { type: 'text/csv;charset=utf-8;' })
    const objectUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const stamp = new Date().toISOString().slice(0, 10)
    link.href = objectUrl
    link.download = `faq-config-${stamp}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(objectUrl)
    setExportMessage('Configuracio exportada en CSV.')
  }

  function openConfigImporter() {
    configImportInputRef.current?.click()
  }

  async function importConfigCsv(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    try {
      const text = await file.text()
      const importedRows = parseConfigCsv(text)
      if (!importedRows.length) {
        throw new Error('El CSV no conte cap topic ni URL per importar.')
      }

      const groupedSources = new Map()

      importedRows.forEach(({ topic, url, enabled }) => {
        const key = topic || '__EMPTY_TOPIC__'
        const currentGroup = groupedSources.get(key) || {
          id: crypto.randomUUID(),
          topic,
          urls: [],
        }

        currentGroup.urls.push({
          id: crypto.randomUUID(),
          value: url,
          enabled,
        })
        groupedSources.set(key, currentGroup)
      })

      const nextSources = Array.from(groupedSources.values()).map((group) => ({
        ...group,
        urls: group.urls.length > 0 ? group.urls : [{ id: crypto.randomUUID(), value: '', enabled: true }],
      }))

      setSources(nextSources.length > 0 ? nextSources : [createEmptySource()])
      setExportMessage(`Configuracio importada: ${nextSources.length} topics carregats.`)
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : 'No s’ha pogut importar el CSV de configuracio.')
    }
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
  return (
    <div className="site-shell">
      <main className="app-shell">
        <section className="hero-banner">
          <div className="hero-copy">
       
            <h1>Eina de gestió de preguntes freqüents de la UPC</h1>
            <p className="hero-text">
              Captura contingut des de webs UPC, revisa’l amb un flux clar i genera el codi HTML final amb una
              aparenca coherent amb l’ecosistema institucional.
            </p>
            <div className="hero-actions">
              <button
                type="button"
                className={`hero-cta ${activeView === 'scrape' ? 'active' : ''}`}
                onClick={() => setActiveView('scrape')}
              >
                <span className="hero-cta-kicker">Captura</span>
                <strong>Descarregador de Preguntes Frequents</strong>
                <span className="hero-cta-copy">Prepara topics, URLs i envia el resultat directament a Google Sheets.</span>
              </button>
              <button
                type="button"
                className={`hero-cta ${activeView === 'export' ? 'active' : ''}`}
                onClick={() => setActiveView('export')}
              >
                <span className="hero-cta-kicker">Publicacio</span>
                <strong>Generador de codi font</strong>
                <span className="hero-cta-copy">Converteix les files aprovades en HTML net i llest per Genweb.</span>
              </button>
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
            <aside className="panel side-panel google-session-panel">
              {googleSession?.connected && googleSession?.profile_picture ? (
                <img
                  className="panel-icon google-avatar"
                  src={googleSession.profile_picture}
                  alt={googleProfileLabel}
                  referrerPolicy="no-referrer"
                />
              ) : null}
              {googleSession?.connected && (
                <div className="google-profile-card">
                  <strong>{googleProfileLabel}</strong>
                  {googleSession?.profile_email && <span>{googleSession.profile_email}</span>}
                </div>
              )}
              <p className={`google-status-row ${googleSession?.connected ? 'connected' : 'disconnected'}`}>
                {!googleSession?.connected && <img className="panel-icon google-badge inline" src={googleLogo} alt="" aria-hidden="true" />}
                <span className={`status ${googleSession?.connected ? 'done' : 'queued'}`}>{googleSession?.connected ? 'Connectat' : 'No connectat'}</span>
              </p>
              <div className="action-stack">
                <button
                  type="button"
                  className={googleSession?.connected ? 'google-session-button connected' : 'google-session-button'}
                  onClick={googleSession?.connected ? logoutGoogle : connectGoogle}
                  disabled={googleBusy}
                >
                  {googleBusy ? (googleSession?.connected ? 'Tancant sessio...' : 'Connectant...') : (googleSession?.connected ? 'Tancar sessio' : 'Iniciar sessio amb Google')}
                </button>
              </div>
              {googleSession?.connected && (
                <div className="drive-browser-card">
                  <button
                    type="button"
                    className={driveBrowserOpen && !creatingNewSheet ? 'nav-pill active' : 'secondary'}
                    onClick={() => {
                      if (creatingNewSheet) {
                        returnToDriveBrowser().catch(() => {})
                        return
                      }
                      if (driveBrowserOpen) {
                        setDriveBrowserOpen(false)
                        return
                      }
                      openDriveBrowser().catch(() => {})
                    }}
                    disabled={driveBusy}
                  >
                    Explorar Drive
                  </button>

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
                <div className="section-head scrape-header">
                  <div className="title-with-icon">
                    <div className="title-row-inline">
                      <img className="section-illustration" src={downloadLogo} alt="" aria-hidden="true" />
                      <h2>Fonts i descàrrega</h2>
                    </div>
                  </div>
                  <div className="config-tools">
                    <button type="button" className="secondary" onClick={exportConfigCsv}>Exportar configuracio CSV</button>
                    <button type="button" className="secondary" onClick={openConfigImporter}>Importar configuracio CSV</button>
                    <button type="button" className="secondary" onClick={addTopic}>Afegir topic</button>
                    <input
                      ref={configImportInputRef}
                      className="sr-only-input"
                      type="file"
                      accept=".csv,text/csv"
                      onChange={importConfigCsv}
                    />
                  </div>
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
                          <label className="url-toggle">
                            <input
                              type="checkbox"
                              checked={url.enabled !== false}
                              onChange={(event) => updateTopic(group.id, url.id, { enabled: event.target.checked })}
                            />
                            <span>{url.enabled !== false ? 'Activa' : 'Pausada'}</span>
                          </label>
                          <input
                            type="url"
                            value={url.value}
                            onChange={(event) => updateTopic(group.id, url.id, { value: event.target.value })}
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
                  <p className="muted">
                    {validSources.length} URLs valides
                    {invalidSources.length > 0 ? ` · ${invalidSources.length} no valides` : ''}
                    {enabledSourceCount > 0 ? ` · ${enabledSourceCount} actives` : ''}
                    {disabledSourceCount > 0 ? ` · ${disabledSourceCount} desactivades` : ''}
                  </p>
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
