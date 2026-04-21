import './App.css'
import './App.css'
import { useEffect, useMemo, useState } from 'react'
import upcRoundLogo from './assets/upc_logo_2.png'
import upcFooterLogo from './assets/upc_logo.png'
import homeLogo from './assets/home_logo.png'
import faqsLogo from './assets/faqs1_logo.png'
import downloadLogo from './assets/download.png'
import htmlLogo from './assets/html-source-code.png'
import googleDriveLogo from './assets/Google_Drive_logo.png'
import googleGroupsIcon from './assets/Google_Groups_icon.png'
import googleLogo from './assets/Google_logo.png'

const defaultApiBase = `${window.location.protocol}//${window.location.hostname}:8000`
const API_BASE = (import.meta.env.VITE_API_URL || defaultApiBase).replace(/\/$/, '')
const STORAGE_KEY = 'upc-faq-manager-state-v2'
const GOOGLE_SESSION_KEY = 'upc-google-session-id'
const FIXED_DRIVE_PATH = 'El meu Drive / UPC / FAQs'
const FIXED_SPREADSHEET_TITLE = 'FAQs'
const FIXED_WORKSHEET_NAME = 'FAQs'
const DEFAULT_SHARE_EMAIL = ''

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
  lastGeneratedCode: '',
  lastSelectedJobId: '',
  selectedFaqSpreadsheetId: '',
  selectedFaqSpreadsheetTitle: FIXED_SPREADSHEET_TITLE,
  selectedConfigFileId: '',
  selectedConfigFileName: '',
  shareRecipients: [{ id: 'default-share', value: DEFAULT_SHARE_EMAIL }],
}

function createEmptySource() {
  return {
    id: crypto.randomUUID(),
    topic: '',
    urls: [{ id: crypto.randomUUID(), value: '', enabled: true }],
  }
}

function createShareRecipient(value = '') {
  return {
    id: crypto.randomUUID(),
    value,
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

function normalizeShareRecipients(input) {
  if (!Array.isArray(input) || input.length === 0) {
    return [createShareRecipient(DEFAULT_SHARE_EMAIL)]
  }

  const normalized = input
    .map((recipient) => ({
      id: typeof recipient?.id === 'string' && recipient.id ? recipient.id : crypto.randomUUID(),
      value: typeof recipient?.value === 'string' ? recipient.value : '',
    }))
    .filter((recipient) => typeof recipient.value === 'string')

  return normalized.length > 0 ? normalized : [createShareRecipient(DEFAULT_SHARE_EMAIL)]
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
    return {
      ...defaultState,
      ...parsed,
      sources: normalizeSources(parsed.sources),
      shareRecipients: normalizeShareRecipients(parsed.shareRecipients),
    }
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
  const [activeView, setActiveView] = useState(persisted.activeView)
  const [sources, setSources] = useState(persisted.sources)
  const [debug] = useState(persisted.debug)
  const [lastGeneratedCode, setLastGeneratedCode] = useState(persisted.lastGeneratedCode)
  const [selectedJobId, setSelectedJobId] = useState(persisted.lastSelectedJobId)
  const [selectedFaqSpreadsheetId, setSelectedFaqSpreadsheetId] = useState(persisted.selectedFaqSpreadsheetId || '')
  const [selectedFaqSpreadsheetTitle, setSelectedFaqSpreadsheetTitle] = useState(persisted.selectedFaqSpreadsheetTitle || FIXED_SPREADSHEET_TITLE)
  const [selectedConfigFileId, setSelectedConfigFileId] = useState(persisted.selectedConfigFileId || '')
  const [selectedConfigFileName, setSelectedConfigFileName] = useState(persisted.selectedConfigFileName || '')

  const [_JOBS, setJobs] = useState([])
  const [selectedJob, setSelectedJob] = useState(null)
  const [jobResult, setJobResult] = useState(null)
  const [_HEALTH, setHealth] = useState(null)
  const [googleSession, setGoogleSession] = useState(null)
  const [activityLogs, setActivityLogs] = useState([])
  const [availableFaqSheets, setAvailableFaqSheets] = useState([])
  const [availableConfigFiles, setAvailableConfigFiles] = useState([])
  const [driveListBusy, setDriveListBusy] = useState(false)
  const [shareBusy, setShareBusy] = useState(false)
  const [saveConfigBusy, setSaveConfigBusy] = useState(false)
  const [shareRecipients, setShareRecipients] = useState(normalizeShareRecipients(persisted.shareRecipients))

  const [processMessage, setProcessMessage] = useState('')
  const [processError, setProcessError] = useState('')
  const [exportMessage, setExportMessage] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [downloadBusy, setDownloadBusy] = useState(false)
  const [generatorBusy, setGeneratorBusy] = useState(false)
  const [generatorProgress, setGeneratorProgress] = useState(0)
  const [generatorCompleted, setGeneratorCompleted] = useState(false)
  const [generatorMissingSheet, setGeneratorMissingSheet] = useState(false)
  const [scrapeVisualProgress, setScrapeVisualProgress] = useState(0)
  const [copyFeedbackVisible, setCopyFeedbackVisible] = useState(false)
  const [logsCollapsed, setLogsCollapsed] = useState(false)
  const [accountCollapsed, setAccountCollapsed] = useState(false)
  const [driveCollapsed, setDriveCollapsed] = useState(false)
  const [shareCollapsed, setShareCollapsed] = useState(false)
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
  const selectedFaqSheet = useMemo(
    () => availableFaqSheets.find((item) => item.id === selectedFaqSpreadsheetId) || null,
    [availableFaqSheets, selectedFaqSpreadsheetId],
  )
  const currentConfigFile = useMemo(
    () => availableConfigFiles.find((item) => item.id === selectedConfigFileId) || null,
    [availableConfigFiles, selectedConfigFileId],
  )

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
        lastGeneratedCode,
        lastSelectedJobId: selectedJobId,
        selectedFaqSpreadsheetId,
        selectedFaqSpreadsheetTitle,
        selectedConfigFileId,
        selectedConfigFileName,
        shareRecipients,
      }),
    )
  }, [
    activeView,
    sources,
    debug,
    lastGeneratedCode,
    selectedJobId,
    selectedFaqSpreadsheetId,
    selectedFaqSpreadsheetTitle,
    selectedConfigFileId,
    selectedConfigFileName,
    shareRecipients,
  ])

  useEffect(() => {
    if (!generatorBusy) return undefined

    setGeneratorProgress(8)
    const timer = window.setInterval(() => {
      setGeneratorProgress((current) => {
        if (current >= 92) return current
        const step = current < 40 ? 9 : (current < 70 ? 5 : 2)
        return Math.min(current + step, 92)
      })
    }, 260)

    return () => window.clearInterval(timer)
  }, [generatorBusy])

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

  async function loadFaqSheets() {
    setDriveListBusy(true)
    try {
      const [faqResponse, configResponse] = await Promise.all([
        apiFetch(`${API_BASE}/api/google/faqs/spreadsheets`),
        apiFetch(`${API_BASE}/api/google/faqs/configurations`),
      ])
      const faqData = await faqResponse.json().catch(() => null)
      const configData = await configResponse.json().catch(() => null)
      if (!faqResponse.ok) throw new Error(faqData?.detail || `HTTP ${faqResponse.status}`)
      if (!configResponse.ok) throw new Error(configData?.detail || `HTTP ${configResponse.status}`)

      const faqItems = Array.isArray(faqData?.items) ? faqData.items : []
      const configItems = Array.isArray(configData?.items) ? configData.items : []
      setAvailableFaqSheets(faqItems)
      setAvailableConfigFiles(configItems)

      if (!faqItems.length) {
        setSelectedFaqSpreadsheetId('')
        setSelectedFaqSpreadsheetTitle(FIXED_SPREADSHEET_TITLE)
      } else {
        const currentSelection = faqItems.find((item) => item.id === selectedFaqSpreadsheetId)
        const preferredSelection = currentSelection
          || faqItems.find((item) => item.name === selectedFaqSpreadsheetTitle)
          || faqItems.find((item) => item.name === FIXED_SPREADSHEET_TITLE)
          || faqItems[0]

        setSelectedFaqSpreadsheetId(preferredSelection.id)
        setSelectedFaqSpreadsheetTitle(preferredSelection.name)
      }

      if (!configItems.length) {
        setSelectedConfigFileId('')
        setSelectedConfigFileName('')
      } else {
        const currentConfig = configItems.find((item) => item.id === selectedConfigFileId)
        const preferredConfig = currentConfig
          || configItems.find((item) => item.name === selectedConfigFileName)
          || configItems[0]
        setSelectedConfigFileId(preferredConfig.id)
        setSelectedConfigFileName(preferredConfig.name)
      }
    } finally {
      setDriveListBusy(false)
    }
  }

  async function shareSelectedFaqFile() {
    const emails = shareRecipients.map((recipient) => recipient.value.trim()).filter(Boolean)
    if (!selectedFaqSpreadsheetId) {
      setExportMessage('Selecciona primer un arxiu de FAQs per compartir.')
      return
    }
    if (!emails.length) {
      setExportMessage('Indica almenys un correu electrònic abans de compartir l’arxiu.')
      return
    }

    setShareBusy(true)
    setExportMessage('')
    try {
      for (const email of emails) {
        const response = await apiFetch(`${API_BASE}/api/google/share-file`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            file_id: selectedFaqSpreadsheetId,
            email,
            role: 'writer',
          }),
        })
        const data = await response.json().catch(() => null)
        if (!response.ok) throw new Error(data?.detail || `HTTP ${response.status}`)
      }
      setExportMessage(`Arxiu ${selectedFaqSheet?.name || selectedFaqSpreadsheetTitle} compartit amb ${emails.join(', ')}.`)
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : 'No s’ha pogut compartir l’arxiu.')
    } finally {
      setShareBusy(false)
    }
  }

  async function loadSelectedConfigFile(fileId, fileName) {
    const cleanFileId = (fileId || '').trim()
    if (!cleanFileId) {
      setSelectedConfigFileId('')
      setSelectedConfigFileName('')
      return
    }

    try {
      const params = new URLSearchParams({ file_id: cleanFileId })
      const response = await apiFetch(`${API_BASE}/api/google/drive/file-content?${params.toString()}`)
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.detail || `HTTP ${response.status}`)
      const importedRows = parseConfigCsv(data?.content || '')
      if (!importedRows.length) {
        throw new Error('La configuracio seleccionada no conte cap topic ni URL.')
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
      setSelectedConfigFileId(cleanFileId)
      setSelectedConfigFileName(fileName || '')
      setExportMessage(`Configuracio carregada des de ${fileName || 'Drive'}.`)
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : 'No s’ha pogut carregar la configuració seleccionada.')
    }
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
    if (!googleSession?.connected) {
      setAvailableFaqSheets([])
      setAvailableConfigFiles([])
      return
    }
    loadFaqSheets().catch(() => {})
  }, [googleSession?.connected])

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
    if (downloadBusy) return
    if (lastAutoExportedJobId === selectedJobId) return

    exportScrapeResult().catch(() => {})
  }, [selectedJobId, selectedJob?.status, googleSession?.connected, downloadBusy, lastAutoExportedJobId])

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

  function buildConfigCsvText() {
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

    return `\uFEFF${rows.join('\r\n')}`
  }

  async function saveConfigToDrive() {
    const stamp = new Date().toISOString().slice(0, 10)
    const suggestedName = (currentConfigFile?.name || selectedConfigFileName || `faq-config-${stamp}.csv`).trim()
    const content = buildConfigCsvText()

    setSaveConfigBusy(true)
    setExportMessage('')
    try {
      const response = await apiFetch(`${API_BASE}/api/google/faqs/configurations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: suggestedName,
          content,
        }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.detail || `HTTP ${response.status}`)
      setSelectedConfigFileId(data.file_id || '')
      setSelectedConfigFileName(data.name || suggestedName)
      setExportMessage(`Configuracio desada a Drive com ${data.name || suggestedName}.`)
      await loadFaqSheets()
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : 'No s’ha pogut desar la configuració a Drive.')
    } finally {
      setSaveConfigBusy(false)
    }
  }

  function addShareRecipient() {
    setShareRecipients((current) => [...current, createShareRecipient('')])
  }

  function updateShareRecipient(id, value) {
    setShareRecipients((current) => current.map((recipient) => (
      recipient.id === id ? { ...recipient, value } : recipient
    )))
  }

  function removeShareRecipient(id) {
    setShareRecipients((current) => {
      if (current.length === 1) return [createShareRecipient('')]
      return current.filter((recipient) => recipient.id !== id)
    })
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
    setScrapeVisualProgress(8)
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
      if (!data?.authorization_url) throw new Error('No s’ha rebut la URL d’autenticació de Google.')

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

    const spreadsheetTitle = selectedFaqSpreadsheetTitle.trim() || FIXED_SPREADSHEET_TITLE
    const worksheetName = FIXED_WORKSHEET_NAME

    setDownloadBusy(true)
    appendActivityLog(`Exportant FAQs a Google Sheets: ${FIXED_DRIVE_PATH} / ${spreadsheetTitle} / ${worksheetName}`)
    try {
      const response = await apiFetch(`${API_BASE}/api/jobs/${selectedJobId}/export/sheets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spreadsheet_title: spreadsheetTitle,
          spreadsheet_id: selectedFaqSpreadsheetId || undefined,
          worksheet_name: worksheetName,
        }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.detail || `HTTP ${response.status}`)
      setExportMessage(`Resultat exportat a Google Sheets a ${FIXED_DRIVE_PATH}/${data.spreadsheet_title}. Fes la revisió i marca Estat=Aprovat al full.`)
      appendActivityLog(`Exportacio completada: ${FIXED_DRIVE_PATH} / ${data.spreadsheet_title} / ${data.worksheet_name}`)
      setLastAutoExportedJobId(selectedJobId)
      setSelectedFaqSpreadsheetTitle(data.spreadsheet_title || spreadsheetTitle)
      await loadGoogleStatus()
      await loadFaqSheets()
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : 'No s’ha pogut exportar a Google Sheets.')
      appendActivityLog(`Error d'exportacio a Google Sheets: ${error instanceof Error ? error.message : 'desconegut'}`)
    } finally {
      setDownloadBusy(false)
    }
  }

  async function generateHtmlFromExternalSource() {
    setExportMessage('')
    setGeneratorMissingSheet(false)
    const formData = new FormData()
    formData.append('input_mode', 'sheets_oauth')

    if (!googleSession?.connected) {
      setExportMessage('Inicia sessió amb Google per generar l’HTML des del Sheet seleccionat.')
      return
    }

    formData.append('spreadsheet_title', selectedFaqSpreadsheetTitle.trim() || FIXED_SPREADSHEET_TITLE)
    formData.append('worksheet_name', FIXED_WORKSHEET_NAME)

    setGeneratorCompleted(false)
    setGeneratorProgress(0)
    setGeneratorBusy(true)
    try {
      const response = await apiFetch(`${API_BASE}/api/export/html-from-source`, {
        method: 'POST',
        body: formData,
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.detail || `HTTP ${response.status}`)
      setLastGeneratedCode(data.html_text || '')
      setGeneratorProgress(100)
      setGeneratorCompleted(true)
      setGeneratorMissingSheet(false)
      setExportMessage('Codi HTML carregat des del document FAQ seleccionat.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No s’ha pogut generar l’HTML.'
      setLastGeneratedCode('')
      setGeneratorCompleted(false)
      setGeneratorProgress(0)
      setGeneratorMissingSheet(message.includes("No s'ha trobat cap document"))
      setExportMessage(message)
    } finally {
      window.setTimeout(() => {
        setGeneratorBusy(false)
      }, 220)
    }
  }

  async function copyGeneratedCode() {
    if (!lastGeneratedCode.trim()) {
      setExportMessage('Encara no hi ha cap codi generat.')
      return
    }
    try {
      await navigator.clipboard.writeText(lastGeneratedCode)
      setCopyFeedbackVisible(true)
      window.setTimeout(() => setCopyFeedbackVisible(false), 1800)
      setExportMessage('Codi HTML copiat al porta-retalls.')
    } catch {
      setCopyFeedbackVisible(false)
      setExportMessage('No s’ha pogut copiar el codi.')
    }
  }

  const expectsAutoExport = Boolean(googleSession?.connected)
  const scrapeProgressPercent = Math.round((selectedJob?.progress_ratio || 0) * 100)
  let progressPercent = scrapeProgressPercent

  if (selectedJob?.status === 'running' && expectsAutoExport) {
    progressPercent = Math.min(scrapeProgressPercent, 88)
  } else if (selectedJob?.status === 'done' && expectsAutoExport) {
    progressPercent = lastAutoExportedJobId === selectedJobId ? 100 : (downloadBusy ? 96 : 90)
  }

  const isScrapeCompleted = Boolean(
    selectedJobId
    && selectedJob?.status === 'done'
    && (!expectsAutoExport || lastAutoExportedJobId === selectedJobId),
  )
  const isScrapeBusy = Boolean(
    submitting
    || (selectedJobId && selectedJob?.status !== 'error' && !isScrapeCompleted),
  )
  const showScrapeInlineProgress = submitting || Boolean(selectedJobId && selectedJob?.status !== 'error')
  const scrapeInlineProgress = Math.round(scrapeVisualProgress)
  const visibleLogs = [...(selectedJob?.logs || []), ...activityLogs]
  const isGoogleConnected = Boolean(googleSession?.connected)
  const isScrapeView = activeView === 'scrape'

  useEffect(() => {
    if (!showScrapeInlineProgress) {
      setScrapeVisualProgress(0)
      return
    }

    const targetProgress = submitting && !selectedJob ? Math.max(progressPercent, 8) : progressPercent

    const timer = window.setInterval(() => {
      setScrapeVisualProgress((current) => {
        if (current === targetProgress) return current
        if (current > targetProgress) return targetProgress

        const difference = targetProgress - current
        const step = targetProgress >= 100 ? Math.max(1, Math.ceil(difference / 4)) : Math.max(1, Math.ceil(difference / 7))
        return Math.min(current + step, targetProgress)
      })
    }, 90)

    return () => window.clearInterval(timer)
  }, [showScrapeInlineProgress, submitting, selectedJob, progressPercent])

  const googleSessionPanel = (
    <aside className="panel side-panel google-session-panel">
      <div className={`selected-sheet-card compact-side-card sidebar-unified-card account-card${accountCollapsed ? ' is-collapsed' : ''}`}>
        <div
          className="compact-card-head side-card-toggle-head"
          role="button"
          tabIndex={0}
          aria-expanded={!accountCollapsed}
          aria-label={accountCollapsed ? 'Mostrar compte Google' : 'Amagar compte Google'}
          onClick={() => setAccountCollapsed((current) => !current)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              setAccountCollapsed((current) => !current)
            }
          }}
        >
          <div className="title-row-inline compact-inline-head">
            <img className="panel-icon google-badge inline" src={googleLogo} alt="" aria-hidden="true" />
            <strong>Compte Google</strong>
          </div>
          <span className="logs-toggle-button side-card-toggle-button" aria-hidden="true">
            <span className={`logs-toggle-icon${accountCollapsed ? '' : ' expanded'}`} aria-hidden="true" />
          </span>
        </div>
        <div className={`collapsible-region${accountCollapsed ? ' is-collapsed' : ''}`}>
          <div className="collapsible-region-inner">
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
            {googleSession?.connected ? (
              <div className="google-status-actions">
                <p className="google-status-row connected">
                  <span className="status done">Connectat</span>
                </p>
                <button
                  type="button"
                  className="google-session-button compact"
                  onClick={logoutGoogle}
                  disabled={googleBusy}
                >
                  {googleBusy ? 'Tancant sessio...' : 'Tancar sessio'}
                </button>
              </div>
            ) : (
              <>
                <p className="google-status-row disconnected">
                  <img className="panel-icon google-badge inline" src={googleLogo} alt="" aria-hidden="true" />
                  <span className="status queued">No connectat</span>
                </p>
                <div className="action-stack">
                  <button
                    type="button"
                    className="google-session-button"
                    onClick={connectGoogle}
                    disabled={googleBusy}
                  >
                    {googleBusy ? 'Connectant...' : 'Iniciar sessio amb Google'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      {googleSession?.connected && (
        <div className="drive-browser-card">
          <div className={`selected-sheet-card compact-side-card sidebar-unified-card${driveCollapsed ? ' is-collapsed' : ''}`}>
            <div
              className="compact-card-head side-card-toggle-head"
              role="button"
              tabIndex={0}
              aria-expanded={!driveCollapsed}
              aria-label={driveCollapsed ? 'Mostrar Google Drive' : 'Amagar Google Drive'}
              onClick={() => setDriveCollapsed((current) => !current)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  setDriveCollapsed((current) => !current)
                }
              }}
            >
              <div className="title-row-inline compact-inline-head">
                <img className="panel-icon google-badge inline" src={googleDriveLogo} alt="" aria-hidden="true" />
                <strong>Google Drive</strong>
              </div>
              <span className="logs-toggle-button side-card-toggle-button" aria-hidden="true">
                <span className={`logs-toggle-icon${driveCollapsed ? '' : ' expanded'}`} aria-hidden="true" />
              </span>
            </div>
            <div className={`collapsible-region${driveCollapsed ? ' is-collapsed' : ''}`}>
              <div className="collapsible-region-inner">
                <label className="field drive-select-field">
                  <span className="field-with-help">
                    <span>Arxiu FAQ</span>
                    <details className="inline-help">
                      <summary>?</summary>
                      <div className="inline-help-popover">Ruta FAQs per defecte: {FIXED_DRIVE_PATH}</div>
                    </details>
                  </span>
                  <select
                    value={selectedFaqSpreadsheetId}
                    onChange={(event) => {
                      const nextId = event.target.value
                      const nextSheet = availableFaqSheets.find((item) => item.id === nextId)
                      setSelectedFaqSpreadsheetId(nextId)
                      setSelectedFaqSpreadsheetTitle(nextSheet?.name || FIXED_SPREADSHEET_TITLE)
                    }}
                    disabled={driveListBusy || !availableFaqSheets.length}
                  >
                    {!availableFaqSheets.length ? (
                      <option value="">No hi ha fitxers disponibles</option>
                    ) : (
                      availableFaqSheets.map((item) => (
                        <option key={item.id} value={item.id}>{item.name}</option>
                      ))
                    )}
                  </select>
                </label>
                {isScrapeView && (
                  <label className="field drive-select-field">
                    <span className="field-with-help">
                      <span>Configuracio CSV</span>
                      <details className="inline-help">
                        <summary>?</summary>
                        <div className="inline-help-popover">Ruta configuracions per defecte: UPC / FAQs / Configuracions</div>
                      </details>
                    </span>
                    <select
                      value={selectedConfigFileId}
                      onChange={(event) => {
                        const nextId = event.target.value
                        const nextConfig = availableConfigFiles.find((item) => item.id === nextId)
                        if (!nextId || !nextConfig) {
                          setSelectedConfigFileId('')
                          setSelectedConfigFileName('')
                          return
                        }
                        loadSelectedConfigFile(nextId, nextConfig.name).catch(() => {})
                      }}
                      disabled={driveListBusy || !availableConfigFiles.length}
                    >
                      {!availableConfigFiles.length ? (
                        <option value="">No hi ha configuracions disponibles</option>
                      ) : (
                        availableConfigFiles.map((item) => (
                          <option key={item.id} value={item.id}>{item.name}</option>
                        ))
                      )}
                    </select>
                  </label>
                )}
              </div>
            </div>
          </div>

          {isScrapeView && (
            <div className={`selected-sheet-card compact-side-card sidebar-unified-card share-side-card${shareCollapsed ? ' is-collapsed' : ''}`}>
              <div
                className="compact-card-head side-card-toggle-head"
                role="button"
                tabIndex={0}
                aria-expanded={!shareCollapsed}
                aria-label={shareCollapsed ? 'Mostrar compartir' : 'Amagar compartir'}
                onClick={() => setShareCollapsed((current) => !current)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    setShareCollapsed((current) => !current)
                  }
                }}
              >
                <div className="share-head">
                  <div className="title-row-inline compact-inline-head">
                    <img className="panel-icon google-badge inline" src={googleGroupsIcon} alt="" aria-hidden="true" />
                    <strong className="field-label-strong">Compartir amb</strong>
                  </div>
                </div>
                <span className="logs-toggle-button side-card-toggle-button" aria-hidden="true">
                  <span className={`logs-toggle-icon${shareCollapsed ? '' : ' expanded'}`} aria-hidden="true" />
                </span>
              </div>
              <div className={`collapsible-region${shareCollapsed ? ' is-collapsed' : ''}`}>
                <div className="collapsible-region-inner">
                  <div className="compact-card-head">
                    <span className="drive-item-kind">{selectedFaqSheet?.name || selectedFaqSpreadsheetTitle || FIXED_SPREADSHEET_TITLE}</span>
                  </div>
                  <div className="sheet-share-block">
                    <div className="share-recipient-list">
                      {shareRecipients.map((recipient, index) => (
                        <div key={recipient.id} className="share-recipient-row">
                          <input
                            type="email"
                            value={recipient.value}
                            onChange={(event) => updateShareRecipient(recipient.id, event.target.value)}
                            placeholder={index === 0 ? 'nom.cognom@upc.edu' : 'altra.persona@upc.edu'}
                          />
                          {shareRecipients.length > 1 && (
                            <button type="button" className="ghost compact-ghost" onClick={() => removeShareRecipient(recipient.id)}>
                              -
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="share-action-row">
                      <button type="button" className="secondary" onClick={shareSelectedFaqFile} disabled={shareBusy || !selectedFaqSpreadsheetId}>
                        {shareBusy ? 'Compartint...' : 'Compartir arxiu'}
                      </button>
                      <button type="button" className="share-add-button" onClick={addShareRecipient}>+</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </aside>
  )
  return (
    <div className="site-shell">
      <main className="app-shell">
        <section className="hero-banner">
          <div className="hero-copy">
       
            <h1>Eina de gestió de preguntes freqüents de la UPC</h1>
            <p className="hero-text">
              Captura contingut des de webs UPC, revisa’l amb un flux clar i genera el codi HTML final amb una
              aparença coherent amb l’ecosistema institucional.
            </p>
            <div className="hero-actions">
              <button
                type="button"
                className={`hero-cta ${activeView === 'scrape' ? 'active' : ''}`}
                onClick={() => setActiveView('scrape')}
              >
                <span className="hero-cta-kicker">Captura</span>
                <strong>Descarregador de Preguntes Freqüents</strong>
                <span className="hero-cta-copy">Prepara topics, URLs i envia el resultat directament a Google Sheets.</span>
              </button>
              <button
                type="button"
                className={`hero-cta ${activeView === 'export' ? 'active' : ''}`}
                onClick={() => setActiveView('export')}
              >
                <span className="hero-cta-kicker">Publicació</span>
                <strong>Generador de codi font</strong>
                <span className="hero-cta-copy">Converteix les files aprovades en HTML net i llest per Genweb.</span>
              </button>
            </div>
          </div>

          <aside className="hero-aside">
            <img className="hero-roundel" src={upcRoundLogo} alt="UPC" />
            <div className="hero-note">Gestio de FAQs</div>
            <div className="hero-note alt">Captura i publicació</div>
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
            {googleSessionPanel}

            <div className="main-stack">
              <div className="main-stack-frame">
                <article className="panel wide scrape-primary-card">
                  <div className="scrape-inner-card">
                    <div className="section-head scrape-header">
                      <div className="title-row-inline">
                        <img className="section-illustration" src={downloadLogo} alt="" aria-hidden="true" />
                        <h2>Fonts i descàrrega</h2>
                      </div>
                      <div className="config-tools">
                        <button type="button" className="secondary" onClick={saveConfigToDrive} disabled={saveConfigBusy || !googleSession?.connected}>
                          {saveConfigBusy ? 'Guardant...' : 'Guardar config'}
                        </button>
                        <button type="button" className="secondary" onClick={addTopic}>Afegir topic</button>
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
                      <div className="action-inline-group">
                        {isGoogleConnected ? (
                          <>
                            <button type="button" onClick={startScrape} disabled={isScrapeBusy}>{isScrapeBusy ? 'Descarregant...' : 'Descarregar FAQs'}</button>
                            {showScrapeInlineProgress && (
                              <div className="mini-progress-row">
                                <div className="mini-progress" aria-live="polite" aria-label={`Descarregant FAQs, ${scrapeInlineProgress}%`}>
                                  <div className="mini-progress-bar">
                                    <span style={{ width: `${scrapeInlineProgress}%` }} />
                                  </div>
                                  <strong>{`${scrapeInlineProgress}%`}</strong>
                                </div>
                                {scrapeInlineProgress >= 100 && <span className="progress-complete-label">Completat</span>}
                              </div>
                            )}
                          </>
                        ) : (
                          <p className="scrape-login-warning">No has iniciat sessio de Google. Connecta&apos;t per descarregar FAQs.</p>
                        )}
                      </div>
                      <p className="muted">
                        {validSources.length} URLs valides
                        {invalidSources.length > 0 ? ` · ${invalidSources.length} no vàlides` : ''}
                        {enabledSourceCount > 0 ? ` · ${enabledSourceCount} actives` : ''}
                        {disabledSourceCount > 0 ? ` · ${disabledSourceCount} desactivades` : ''}
                      </p>
                    </div>
                  </div>
                </article>

                {isGoogleConnected && (
                  <article
                    className="panel wide scrape-logs-card logs-collapsible-card"
                    role="button"
                    tabIndex={0}
                    aria-expanded={!logsCollapsed}
                    aria-label={logsCollapsed ? 'Mostrar logs' : 'Amagar logs'}
                    onClick={() => setLogsCollapsed((current) => !current)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setLogsCollapsed((current) => !current)
                      }
                    }}
                  >
                    <div className="section-head">
                      <div>
                        <h2>Logs</h2>
                      </div>
                      <span className="logs-toggle-button" aria-hidden="true">
                        <span className={`logs-toggle-icon${logsCollapsed ? '' : ' expanded'}`} aria-hidden="true" />
                      </span>
                    </div>
                    <div className={`collapsible-region${logsCollapsed ? ' is-collapsed' : ''}`}>
                      <div className="collapsible-region-inner">
                        {jobResult && (
                          <div className="summary-grid">
                            <div>URLs processades: {jobResult.stats?.total_urls ?? 0}</div>
                            <div>FAQs trobades: {jobResult.stats?.total_faqs ?? 0}</div>
                            <div>Files generades: {jobResult.stats?.total_rows ?? 0}</div>
                            <div>Errors: {jobResult.stats?.total_errors ?? 0}</div>
                          </div>
                        )}

                        <pre>{visibleLogs.join('\n') || 'Sense logs encara.'}</pre>
                      </div>
                    </div>
                  </article>
                )}
              </div>
            </div>
          </section>
        )}

        {activeView === 'export' && (
          <section className="content-grid export-layout">
            <div className="sidebar-stack">
              {googleSessionPanel}
            </div>

            <div className="main-stack">
              <div className="main-stack-frame">
                <article className="panel export-primary-card">
                  <div className="section-head">
                    <div className="title-with-icon">
                      <div className="title-row-inline">
                        <img className="section-illustration" src={htmlLogo} alt="" aria-hidden="true" />
                        <h2>Exporta codi font per Genweb</h2>
                      </div>
                    </div>
                  </div>

                  <p className="muted">
                    Es generarà el codi font de les FAQs amb estat Aprovat.
                    {' '}
                    Arxiu seleccionat: <strong>{selectedFaqSheet?.name || selectedFaqSpreadsheetTitle || FIXED_SPREADSHEET_TITLE}</strong>.
                  </p>

                  <div className="action-stack">
                    {isGoogleConnected ? (
                      <>
                        <button type="button" onClick={generateHtmlFromExternalSource} disabled={generatorBusy}>{generatorBusy ? 'Generant...' : 'Generar codi font'}</button>
                        {generatorMissingSheet ? (
                          <div className="generator-error-box" role="alert">
                            No hi ha cap arxiu Excel amb FAQs.
                          </div>
                        ) : (generatorBusy || generatorCompleted) && (
                          <div className="mini-progress-row">
                            <div className="mini-progress" aria-live="polite" aria-label={`Generant codi, ${generatorProgress}%`}>
                              <div className="mini-progress-bar">
                                <span style={{ width: `${generatorProgress}%` }} />
                              </div>
                              <strong>{`${generatorProgress}%`}</strong>
                            </div>
                            {generatorCompleted && <span className="progress-complete-label">Completat</span>}
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="scrape-login-warning">No has iniciat sessió de Google. Connecta&apos;t per generar el codi font.</p>
                    )}
                  </div>
                </article>

                <article className="panel wide export-code-card">
                  <div className="section-head">
                    <div>
                      <h2>Codi font</h2>
                    </div>
                  </div>
                  <pre className="code-block">{lastGeneratedCode || 'Encara no s’ha generat cap HTML.'}</pre>
                  <div className="code-hint-row">
                    {lastGeneratedCode.trim() && (
                      <>
                        <button type="button" className="copy-inline-button" onClick={copyGeneratedCode}>
                          Copia
                        </button>
                        {copyFeedbackVisible && <span className="copy-success-indicator">?</span>}
                      </>
                    )}
                    <p className="muted">Enganxa aquest codi en un bloc HTML de Genweb. El resultat ja ve agrupat i amb el comportament d’acordió.</p>
                  </div>
                </article>
              </div>
            </div>
          </section>
        )}

        <footer className="home-footnote">
          <img className="footer-logo" src={upcFooterLogo} alt="Universitat Politecnica de Catalunya" />
          <div className="footer-copy">
            <p><strong>Credits: UPC ESEIAAT</strong></p>
            <p>
              Eina desenvolupada en el marc del projecte Genweb de la Universitat Politecnica de Catalunya (UPC)
              per a la gestio i publicacio de continguts FAQ.
            </p>
          </div>
        </footer>
      </main>
    </div>
  )
}

