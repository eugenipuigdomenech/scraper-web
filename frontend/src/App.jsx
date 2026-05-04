import './App.css'
import './App.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import upcRoundLogo from './assets/upc_logo_2.png'
import upcFooterLogo from './assets/upc_logo.png'
import homeLogo from './assets/home_logo.png'
import faqsLogo from './assets/faqs1_logo.png'
import googleLogo from './assets/Google_logo.png'

const defaultApiBase = `${window.location.protocol}//${window.location.hostname}:8000`
const API_BASE = (import.meta.env.VITE_API_URL || defaultApiBase).replace(/\/$/, '')
const STORAGE_KEY = 'upc-faq-manager-state-v2'
const GOOGLE_SESSION_KEY = 'upc-google-session-id'
const FIXED_DRIVE_PATH = 'El meu Drive / UPC / FAQs'
const FIXED_SPREADSHEET_TITLE = 'FAQs'
const FIXED_WORKSHEET_NAME = 'FAQs'
const DEFAULT_SHARE_EMAIL = ''

function createId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }

  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

const defaultSources = [
  {
    id: createId(),
    topic: 'Admissions',
    urls: [{ id: createId(), value: '', enabled: true }],
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
    id: createId(),
    topic: '',
    urls: [{ id: createId(), value: '', enabled: true }],
  }
}

function createShareRecipient(value = '') {
  return {
    id: createId(),
    value,
  }
}

function formatConfigDisplayName(name) {
  return (name || '').replace(/\.csv$/i, '')
}

function normalizeUrlRow(row) {
  if (typeof row === 'string') {
    return { id: createId(), value: row, enabled: true }
  }

  return {
    id: typeof row?.id === 'string' && row.id ? row.id : createId(),
    value: typeof row?.value === 'string' ? row.value : '',
    enabled: row?.enabled !== false,
  }
}

function normalizeSources(input) {
  if (!Array.isArray(input) || input.length === 0) return defaultSources

  const normalized = input.map((group) => ({
    id: typeof group?.id === 'string' && group.id ? group.id : createId(),
    topic: typeof group?.topic === 'string' ? group.topic : '',
    urls:
      Array.isArray(group?.urls) && group.urls.length > 0
        ? group.urls.map(normalizeUrlRow)
        : [{ id: createId(), value: '', enabled: true }],
  }))

  return normalized.length > 0 ? normalized : defaultSources
}

function normalizeShareRecipients(input) {
  if (!Array.isArray(input) || input.length === 0) {
    return [createShareRecipient(DEFAULT_SHARE_EMAIL)]
  }

  const normalized = input
    .map((recipient) => ({
      id: typeof recipient?.id === 'string' && recipient.id ? recipient.id : createId(),
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
  const normalizedText = `${text || ''}`.replace(/^\uFEFF/, '').replace(/^ï»¿/, '')
  const allLines = normalizedText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')

  if (!allLines.length) return { rows: [], debug: { totalLines: 0, candidateLines: 0, delimiter: 'unknown', hasHeader: false, parsedRows: 0 } }

  const firstUsefulLine = allLines.find((line) => !/^sep\s*=/i.test(line)) || allLines[0]
  const delimiter = firstUsefulLine.includes(';')
    ? ';'
    : (firstUsefulLine.includes('\t') ? '\t' : ',')

  const parseCsvLine = (line) => {
    const cells = []
    let current = ''
    let insideQuotes = false
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index]
      const next = line[index + 1]
      if (char === '"') {
        if (insideQuotes && next === '"') {
          current += '"'
          index += 1
        } else {
          insideQuotes = !insideQuotes
        }
        continue
      }
      if (char === delimiter && !insideQuotes) {
        cells.push(current.trim())
        current = ''
        continue
      }
      current += char
    }
    cells.push(current.trim())
    return cells
  }

  const candidateLines = allLines.filter((line) => !/^sep\s*=/i.test(line))
  if (!candidateLines.length) {
    return {
      rows: [],
      debug: {
        totalLines: allLines.length,
        candidateLines: 0,
        delimiter,
        hasHeader: false,
        parsedRows: 0,
      },
    }
  }

  const normalizeHeaderCell = (cell) => (
    `${cell || ''}`
      .replace(/^\uFEFF/, '')
      .replace(/^ï»¿/, '')
      .trim()
      .toLowerCase()
  )
  const header = parseCsvLine(candidateLines[0]).map(normalizeHeaderCell)
  const topicIndex = header.findIndex((value) => ['topic', 'tema'].includes(value))
  const urlIndex = header.findIndex((value) => ['url', 'link', 'enllac'].includes(value))
  const enabledIndex = header.findIndex((value) => ['enabled', 'actiu', 'activa'].includes(value))
  const hasHeader = topicIndex !== -1 && urlIndex !== -1

  const dataLines = hasHeader ? candidateLines.slice(1) : candidateLines
  const rows = dataLines.map(parseCsvLine)

  if (hasHeader) {
    const parsedWithHeader = rows
      .map((cells) => ({
        topic: (cells[topicIndex] || '').trim(),
        url: (cells[urlIndex] || '').trim(),
        enabled: enabledIndex === -1
          ? true
          : !['false', '0', 'no', 'off'].includes(((cells[enabledIndex] || '').trim().toLowerCase())),
      }))
      .filter((row) => row.topic !== '' || row.url !== '')
    return {
      rows: parsedWithHeader,
      debug: {
        totalLines: allLines.length,
        candidateLines: candidateLines.length,
        delimiter,
        hasHeader: true,
        parsedRows: parsedWithHeader.length,
      },
    }
  }

  // Fallback per fitxers antics sense capçalera: topic a columna 1, url a columna 2.
  const parsedFallback = rows
    .map((cells) => {
      const first = (cells[0] || '').trim()
      const second = (cells[1] || '').trim()
      const firstIsUrl = /^https?:\/\//i.test(first)
      const secondIsUrl = /^https?:\/\//i.test(second)
      if (firstIsUrl && !secondIsUrl) {
        return { topic: second, url: first, enabled: true }
      }
      return { topic: first, url: second, enabled: true }
    })
    .filter((row) => row.topic !== '' || row.url !== '')
  return {
    rows: parsedFallback,
    debug: {
      totalLines: allLines.length,
      candidateLines: candidateLines.length,
      delimiter,
      hasHeader: false,
      parsedRows: parsedFallback.length,
    },
  }
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
      lastGeneratedCode: '',
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

function hasConfigContent(groups) {
  if (!Array.isArray(groups)) return false
  return groups.some((group) => {
    const topic = (group?.topic || '').trim()
    const hasUrlValue = Array.isArray(group?.urls) && group.urls.some((url) => (url?.value || '').trim() !== '')
    return topic !== '' || hasUrlValue
  })
}

function getGoogleSessionId() {
  let current = window.localStorage.getItem(GOOGLE_SESSION_KEY)
  if (current) return current
  current = createId()
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
  const [selectedConfigFileId, setSelectedConfigFileId] = useState('')
  const [selectedConfigFileName, setSelectedConfigFileName] = useState('')
  const [configSelectionType, setConfigSelectionType] = useState('none')
  const [sheetSelectionMode, setSheetSelectionMode] = useState('')
  const [newSpreadsheetTitle, setNewSpreadsheetTitle] = useState('')
  const [newConfigFileName, setNewConfigFileName] = useState('')

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
  const [, setSaveConfigBusy] = useState(false)
  const [shareRecipients, setShareRecipients] = useState(normalizeShareRecipients(persisted.shareRecipients))

  const [processMessage, setProcessMessage] = useState('')
  const [processError, setProcessError] = useState('')
  const [exportMessage, setExportMessage] = useState('')
  const [genwebUrl, setGenwebUrl] = useState('')
  const [genwebUsername, setGenwebUsername] = useState('')
  const [genwebPassword, setGenwebPassword] = useState('')
  const [genwebPublishBusy, setGenwebPublishBusy] = useState(false)
  const [genwebPublishMessage, setGenwebPublishMessage] = useState('')
  const [genwebPublishError, setGenwebPublishError] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [downloadBusy, setDownloadBusy] = useState(false)
  const [generatorBusy, setGeneratorBusy] = useState(false)
  const [generatorProgress, setGeneratorProgress] = useState(0)
  const [generatorCompleted, setGeneratorCompleted] = useState(false)
  const [generatorMissingSheet, setGeneratorMissingSheet] = useState(false)
  const [generatorNoApprovedFaqs, setGeneratorNoApprovedFaqs] = useState(false)
  const [generatorApprovedRows, setGeneratorApprovedRows] = useState(0)
  const [generatorSubtopics, setGeneratorSubtopics] = useState(0)
  const [exportStep, setExportStep] = useState(1)
  const [scrapeVisualProgress, setScrapeVisualProgress] = useState(0)
  const [logsCollapsed, setLogsCollapsed] = useState(false)
  const [googleBusy, setGoogleBusy] = useState(false)
  const [lastAutoExportedJobId, setLastAutoExportedJobId] = useState('')
  const [scrapeStep, setScrapeStep] = useState(1)
  const [hasUnlockedStepFlow, setHasUnlockedStepFlow] = useState(false)
  const [autosaveStatus, setAutosaveStatus] = useState('idle')
  const [loadedConfigSummaryFileId, setLoadedConfigSummaryFileId] = useState('')
  const [loadingConfigFileId, setLoadingConfigFileId] = useState('')
  const [loadedConfigStats, setLoadedConfigStats] = useState({ fileId: '', topics: 0, urls: 0 })
  const [selectedSheetStats, setSelectedSheetStats] = useState({ spreadsheetId: '', totalFaqs: 0, approvedFaqs: 0 })
  const [loadingSheetStatsId, setLoadingSheetStatsId] = useState('')
  const [selectedSheetShareInfo, setSelectedSheetShareInfo] = useState({ spreadsheetId: '', sharedPeopleCount: 0, sharedPeople: [] })
  const [loadingSheetShareId, setLoadingSheetShareId] = useState('')
  const autosaveTimerRef = useRef(null)
  const autosaveInitializedRef = useRef(false)
  const lastAutosaveKeyRef = useRef('')
  const sourcesEditedRef = useRef(false)
  const configLoadRequestIdRef = useRef(0)
  const configLoadAbortRef = useRef(null)
  const configLoadInProgressRef = useRef(false)
  const sheetStepInitializedRef = useRef(false)

  const { valid: validSources, invalid: invalidSources } = useMemo(() => extractUniqueSources(sources), [sources])
  const isGoogleConnected = Boolean(googleSession?.connected)
  const googleProfileLabel = googleSession?.profile_name || googleSession?.profile_email || 'Sessio de Google'
  const configPickerValue = configSelectionType === 'new' ? '__NEW__' : selectedConfigFileId
  const configStepComplete = configSelectionType !== 'none'
  const sheetStepEnabled = isGoogleConnected && configStepComplete
  const sheetStepComplete = sheetStepEnabled && (
    sheetSelectionMode === 'existing'
      ? Boolean(selectedFaqSpreadsheetId)
      : (sheetSelectionMode === 'new' && Boolean((newSpreadsheetTitle || '').trim()))
  )
  const shareStepEnabled = sheetStepComplete
  const downloaderStepEnabled = hasUnlockedStepFlow || shareStepEnabled
  const step2Enabled = hasUnlockedStepFlow || configStepComplete
  const step3Enabled = hasUnlockedStepFlow || sheetStepComplete
  const step4Enabled = hasUnlockedStepFlow || scrapeStep >= 3
  const canGoNextStep = scrapeStep === 1
    ? step2Enabled
    : (scrapeStep === 2
      ? step3Enabled
      : scrapeStep === 3)
  const exportStep1Enabled = isGoogleConnected
  const exportStep2Enabled = isGoogleConnected && Boolean(selectedFaqSpreadsheetId)
  const exportStep3Enabled = exportStep2Enabled && Boolean(lastGeneratedCode.trim())
  const canGoNextExportStep = exportStep2Enabled
  const workflowSteps = [
    { id: 1, title: 'Pas 1: Configuració', enabled: true },
    { id: 2, title: 'Pas 2: Fitxer Sheets', enabled: step2Enabled },
    { id: 3, title: 'Pas 3: Compartir', enabled: step3Enabled },
    { id: 4, title: 'Pas 4: Descarregador', enabled: step4Enabled },
  ]
  const workflowSidebarMessage = !isGoogleConnected
    ? ''
    : (scrapeStep === 1
      ? 'Pas 1. Tria una configuració existent o crea una configuració nova.'
      : (scrapeStep === 2
        ? 'Pas 2. Tria el Google Sheet de destí o crea’n un de nou.'
        : (scrapeStep === 3
          ? 'Pas 3. Decideix si vols compartir el fitxer i amb qui.'
          : 'Pas 4. Defineix topics i URLs, i executa la descàrrega de FAQs.')))
  const exportWorkflowMessage = !isGoogleConnected
    ? ''
    : (!availableFaqSheets.length
      ? 'No hi ha arxius FAQ disponibles. Primer genera o exporta un arxiu FAQ.'
      : (!selectedFaqSpreadsheetId
        ? 'Tria l’arxiu FAQ que vols convertir a codi font.'
        : (generatorBusy
          ? 'S’està generant el codi font.'
          : 'Arxiu FAQ triat. Ara genera el codi font.')))
  const selectedFaqSheet = useMemo(
    () => availableFaqSheets.find((item) => item.id === selectedFaqSpreadsheetId) || null,
    [availableFaqSheets, selectedFaqSpreadsheetId],
  )
  const currentConfigFile = useMemo(
    () => availableConfigFiles.find((item) => item.id === selectedConfigFileId) || null,
    [availableConfigFiles, selectedConfigFileId],
  )
  const completedFaqCount = jobResult?.stats?.total_faqs ?? 0
  const loadedConfigTopicsCount = useMemo(
    () => sources.filter((group) => {
      const hasTopic = (group.topic || '').trim() !== ''
      const hasAnyUrl = Array.isArray(group.urls) && group.urls.some((url) => (url.value || '').trim() !== '')
      return hasTopic || hasAnyUrl
    }).length,
    [sources],
  )
  const loadedConfigUrlsCount = useMemo(
    () => sources.reduce((acc, group) => acc + (Array.isArray(group.urls) ? group.urls.filter((url) => (url.value || '').trim() !== '').length : 0), 0),
    [sources],
  )
  const exportedSpreadsheetLabel = selectedFaqSheet?.name || selectedFaqSpreadsheetTitle || FIXED_SPREADSHEET_TITLE
  const savedConfigLabel = currentConfigFile?.name || selectedConfigFileName || newConfigFileName || 'configuracio actual'
  const showDownloadSuccessBanner = isGoogleConnected && downloaderStepEnabled && scrapeVisualProgress >= 100 && Boolean(jobResult)
  const urlsWithoutFaqs = useMemo(() => {
    const blocks = Array.isArray(jobResult?.blocks) ? jobResult.blocks : []
    return blocks
      .filter((block) => (Array.isArray(block?.items) ? block.items.length === 0 : true))
      .map((block) => (block?.source_url || '').trim())
      .filter(Boolean)
  }, [jobResult])
  const hasNoFaqsAnywhere = Boolean(jobResult) && scrapeVisualProgress >= 100 && completedFaqCount === 0
  const hasPartialNoFaqs = Boolean(jobResult) && scrapeVisualProgress >= 100 && completedFaqCount > 0 && urlsWithoutFaqs.length > 0
  const hasInvalidUrlsInForm = invalidSources.length > 0

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
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          activeView,
          sources,
          debug,
          lastSelectedJobId: selectedJobId,
          selectedFaqSpreadsheetId,
          selectedFaqSpreadsheetTitle,
          selectedConfigFileId,
          selectedConfigFileName,
          shareRecipients,
        }),
      )
    } catch (error) {
      console.error('No s’ha pogut desar l’estat local de la UI.', error)
    }
  }, [
    activeView,
    sources,
    debug,
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
        if (currentSelection) {
          setSelectedFaqSpreadsheetId(currentSelection.id)
          setSelectedFaqSpreadsheetTitle(currentSelection.name)
        } else {
          // No autoseleccionem cap fitxer: el selector ha de quedar al placeholder per defecte.
          setSelectedFaqSpreadsheetId('')
          setSelectedFaqSpreadsheetTitle(FIXED_SPREADSHEET_TITLE)
          setSheetSelectionMode('')
        }
      }

      if (!configItems.length) {
        setSelectedConfigFileId('')
        setSelectedConfigFileName('')
        setNewConfigFileName('')
        setConfigSelectionType('none')
      }
    } finally {
      setDriveListBusy(false)
    }
  }

  async function shareSelectedFaqFile() {
    const emails = shareRecipients.map((recipient) => recipient.value.trim()).filter(Boolean)
    const fileName = selectedFaqSheet?.name || selectedFaqSpreadsheetTitle || FIXED_SPREADSHEET_TITLE
    if (!selectedFaqSpreadsheetId) {
      setExportMessage('Selecciona primer un arxiu de FAQs per compartir.')
      return false
    }
    if (!emails.length) {
      setExportMessage('Indica almenys un correu electrònic abans de compartir l’arxiu.')
      return false
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
      try {
        const params = new URLSearchParams({ file_id: selectedFaqSpreadsheetId })
        const countResponse = await apiFetch(`${API_BASE}/api/google/drive/share-count?${params.toString()}`)
        const countData = await countResponse.json().catch(() => null)
        if (countResponse.ok) {
          setSelectedSheetShareInfo({
            spreadsheetId: selectedFaqSpreadsheetId,
            sharedPeopleCount: Number(countData?.shared_people_count || 0),
            sharedPeople: Array.isArray(countData?.shared_people) ? countData.shared_people : [],
          })
        }
      } catch {
        // Ignore share-count refresh errors; the share itself already succeeded.
      }
      setExportMessage(`Arxiu ${fileName} compartit amb ${emails.join(', ')}.`)
      return true
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : 'No s’ha pogut compartir l’arxiu.')
      return false
    } finally {
      setShareBusy(false)
    }
  }

  function applyImportedConfigRows(importedRows, originLabel, fileId = '') {
    if (!importedRows.length) {
      setSources([createEmptySource()])
      setLoadedConfigStats({ fileId, topics: 0, urls: 0 })
      setExportMessage(`Configuracio carregada des de ${originLabel}. El fitxer esta buit; pots afegir topics i URLs al Pas 4.`)
      return
    }

    const groupedSources = new Map()
    importedRows.forEach(({ topic, url, enabled }) => {
      const key = topic || '__EMPTY_TOPIC__'
      const currentGroup = groupedSources.get(key) || {
        id: createId(),
        topic,
        urls: [],
      }
      currentGroup.urls.push({
        id: createId(),
        value: url,
        enabled,
      })
      groupedSources.set(key, currentGroup)
    })

    const nextSources = Array.from(groupedSources.values()).map((group) => ({
      ...group,
      urls: group.urls.length > 0 ? group.urls : [{ id: createId(), value: '', enabled: true }],
    }))

    const topicCount = nextSources.filter((group) => {
      const hasTopic = (group.topic || '').trim() !== ''
      const hasAnyUrl = Array.isArray(group.urls) && group.urls.some((url) => (url.value || '').trim() !== '')
      return hasTopic || hasAnyUrl
    }).length
    const urlCount = nextSources.reduce(
      (acc, group) => acc + (Array.isArray(group.urls) ? group.urls.filter((url) => (url.value || '').trim() !== '').length : 0),
      0,
    )

    setSources(nextSources.length > 0 ? nextSources : [createEmptySource()])
    setLoadedConfigStats({ fileId, topics: topicCount, urls: urlCount })
    sourcesEditedRef.current = false
    setExportMessage(`Configuracio carregada des de ${originLabel}.`)
  }

  function createNewConfiguration() {
    setSources([createEmptySource()])
    setSelectedConfigFileId('')
    setSelectedConfigFileName('')
    setConfigSelectionType('new')
    setNewConfigFileName('')
    setLoadedConfigSummaryFileId('')
    setLoadedConfigStats({ fileId: '', topics: 0, urls: 0 })
    sourcesEditedRef.current = false
    autosaveInitializedRef.current = false
    lastAutosaveKeyRef.current = ''
    setExportMessage('Nova configuracio preparada. Ja pots afegir topics i URLs.')
  }

  async function loadSelectedConfigFile(fileId, fileName) {
    const cleanFileId = (fileId || '').trim()
    const requestId = configLoadRequestIdRef.current + 1
    configLoadRequestIdRef.current = requestId
    configLoadInProgressRef.current = true
    sourcesEditedRef.current = false
    if (configLoadAbortRef.current) {
      configLoadAbortRef.current.abort()
    }
    const abortController = new AbortController()
    configLoadAbortRef.current = abortController

    if (!cleanFileId) {
      setSelectedConfigFileId('')
      setSelectedConfigFileName('')
      setConfigSelectionType('none')
      setNewConfigFileName('')
      setLoadedConfigSummaryFileId('')
      setLoadedConfigStats({ fileId: '', topics: 0, urls: 0 })
      return
    }

    setSelectedConfigFileId(cleanFileId)
    setSelectedConfigFileName(fileName || '')
    setConfigSelectionType('drive')
    setNewConfigFileName('')
    setLoadedConfigSummaryFileId('')
    setLoadingConfigFileId(cleanFileId)

    try {
      const params = new URLSearchParams({ file_id: cleanFileId })
      const response = await apiFetch(`${API_BASE}/api/google/drive/file-content?${params.toString()}`, {
        signal: abortController.signal,
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.detail || `HTTP ${response.status}`)
      if (requestId !== configLoadRequestIdRef.current) return
      const parsedConfig = parseConfigCsv(data?.content || '')
      const importedRows = parsedConfig.rows
      applyImportedConfigRows(importedRows, fileName || 'Drive', cleanFileId)
      setLoadedConfigSummaryFileId(cleanFileId)
      setLoadingConfigFileId('')
      autosaveInitializedRef.current = false
      lastAutosaveKeyRef.current = ''
    } catch (error) {
      if (abortController.signal.aborted) return
      if (requestId !== configLoadRequestIdRef.current) return
      setLoadedConfigSummaryFileId('')
      setLoadingConfigFileId('')
      setLoadedConfigStats({ fileId: '', topics: 0, urls: 0 })
      setExportMessage(error instanceof Error ? error.message : 'No s’ha pogut carregar la configuració seleccionada.')
    } finally {
      configLoadInProgressRef.current = false
      if (configLoadAbortRef.current === abortController) {
        configLoadAbortRef.current = null
      }
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
      setSelectedConfigFileId('')
      setSelectedConfigFileName('')
      setConfigSelectionType('none')
      setNewConfigFileName('')
      setLoadedConfigStats({ fileId: '', topics: 0, urls: 0 })
      setSheetSelectionMode('')
      setNewSpreadsheetTitle('')
      setHasUnlockedStepFlow(false)
      setSelectedSheetStats({ spreadsheetId: '', totalFaqs: 0, approvedFaqs: 0 })
      setLoadingSheetStatsId('')
      setSelectedSheetShareInfo({ spreadsheetId: '', sharedPeopleCount: 0, sharedPeople: [] })
      setLoadingSheetShareId('')
      return
    }
    loadFaqSheets().catch(() => {})
  }, [googleSession?.connected])

  useEffect(() => {
    const cleanSpreadsheetId = (selectedFaqSpreadsheetId || '').trim()
    if (!isGoogleConnected || !cleanSpreadsheetId || sheetSelectionMode === 'new') {
      setSelectedSheetStats({ spreadsheetId: '', totalFaqs: 0, approvedFaqs: 0 })
      setLoadingSheetStatsId('')
      return
    }

    let cancelled = false
    const loadStats = async () => {
      setLoadingSheetStatsId(cleanSpreadsheetId)
      try {
        const params = new URLSearchParams({
          spreadsheet_id: cleanSpreadsheetId,
          worksheet_name: FIXED_WORKSHEET_NAME,
        })
        const response = await apiFetch(`${API_BASE}/api/google/faqs/spreadsheet-stats?${params.toString()}`)
        const data = await response.json().catch(() => null)
        if (!response.ok) throw new Error(data?.detail || `HTTP ${response.status}`)
        if (cancelled) return
        setSelectedSheetStats({
          spreadsheetId: cleanSpreadsheetId,
          totalFaqs: Number(data?.total_faqs || 0),
          approvedFaqs: Number(data?.approved_faqs || 0),
        })
      } catch {
        if (cancelled) return
        setSelectedSheetStats({ spreadsheetId: cleanSpreadsheetId, totalFaqs: 0, approvedFaqs: 0 })
      } finally {
        if (!cancelled) setLoadingSheetStatsId('')
      }
    }

    loadStats().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [isGoogleConnected, selectedFaqSpreadsheetId, sheetSelectionMode])

  useEffect(() => {
    const cleanSpreadsheetId = (selectedFaqSpreadsheetId || '').trim()
    if (!isGoogleConnected || !cleanSpreadsheetId || sheetSelectionMode === 'new') {
      setSelectedSheetShareInfo({ spreadsheetId: '', sharedPeopleCount: 0 })
      setLoadingSheetShareId('')
      return
    }

    let cancelled = false
    const loadShareInfo = async () => {
      setLoadingSheetShareId(cleanSpreadsheetId)
      try {
        const params = new URLSearchParams({ file_id: cleanSpreadsheetId })
        const response = await apiFetch(`${API_BASE}/api/google/drive/share-count?${params.toString()}`)
        const data = await response.json().catch(() => null)
        if (!response.ok) throw new Error(data?.detail || `HTTP ${response.status}`)
        if (cancelled) return
        setSelectedSheetShareInfo({
          spreadsheetId: cleanSpreadsheetId,
          sharedPeopleCount: Number(data?.shared_people_count || 0),
          sharedPeople: Array.isArray(data?.shared_people) ? data.shared_people : [],
        })
      } catch {
        if (cancelled) return
        setSelectedSheetShareInfo({ spreadsheetId: cleanSpreadsheetId, sharedPeopleCount: 0, sharedPeople: [] })
      } finally {
        if (!cancelled) setLoadingSheetShareId('')
      }
    }

    loadShareInfo().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [isGoogleConnected, selectedFaqSpreadsheetId, sheetSelectionMode])

  useEffect(() => {
    if (scrapeStep === 4) setHasUnlockedStepFlow(true)
  }, [scrapeStep])

  useEffect(() => {
    if (scrapeStep !== 2 || sheetStepInitializedRef.current) return
    sheetStepInitializedRef.current = true
    setSheetSelectionMode('')
    setSelectedFaqSpreadsheetId('')
    setSelectedFaqSpreadsheetTitle(FIXED_SPREADSHEET_TITLE)
    setNewSpreadsheetTitle('')
  }, [scrapeStep])

  function goToScrapeStep(targetStep) {
    if (!Number.isFinite(targetStep)) return
    const nextStep = Math.max(1, Math.min(targetStep, 4))
    if (nextStep === 2 && !step2Enabled) return
    if (nextStep === 3 && !step3Enabled) return
    if (nextStep === 4 && !step4Enabled) return
    setScrapeStep(nextStep)
  }

  function resetScrapeWorkflow() {
    if (configLoadAbortRef.current) {
      configLoadAbortRef.current.abort()
      configLoadAbortRef.current = null
    }
    configLoadInProgressRef.current = false
    configLoadRequestIdRef.current += 1

    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = null
    }
    autosaveInitializedRef.current = false
    lastAutosaveKeyRef.current = ''
    sourcesEditedRef.current = false

    setSources([createEmptySource()])
    setSelectedConfigFileId('')
    setSelectedConfigFileName('')
    setConfigSelectionType('none')
    setLoadedConfigSummaryFileId('')
    setLoadingConfigFileId('')
    setLoadedConfigStats({ fileId: '', topics: 0, urls: 0 })
    setNewConfigFileName('')

    setSheetSelectionMode('')
    setSelectedFaqSpreadsheetId('')
    setSelectedFaqSpreadsheetTitle(FIXED_SPREADSHEET_TITLE)
    setNewSpreadsheetTitle('')
    sheetStepInitializedRef.current = false

    setShareRecipients([createShareRecipient(DEFAULT_SHARE_EMAIL)])
    setShareBusy(false)
    setAutosaveStatus('idle')
    setHasUnlockedStepFlow(false)

    setActivityLogs([])
    setJobResult(null)
    setSelectedJob(null)
    setSelectedJobId('')
    setScrapeVisualProgress(0)
    setLogsCollapsed(false)
    setLastAutoExportedJobId('')

    setProcessMessage('')
    setProcessError('')
    setExportMessage('')
    setScrapeStep(1)
  }

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
    sourcesEditedRef.current = true
    setSources((current) => [
      ...current,
      createEmptySource(),
    ])
  }

  function updateTopic(id, field, value) {
    sourcesEditedRef.current = true
    setSources((current) =>
      current.map((group) => {
        if (group.id !== id) return group
        if (field === 'topic') return { ...group, topic: value }
        return { ...group, urls: group.urls.map((url) => (url.id === field ? { ...url, ...value } : url)) }
      }),
    )
  }

  function addUrl(topicId) {
    sourcesEditedRef.current = true
    setSources((current) =>
      current.map((group) =>
        group.id === topicId
          ? { ...group, urls: [...group.urls, { id: createId(), value: '', enabled: true }] }
          : group,
      ),
    )
  }

  function removeTopic(topicId) {
    sourcesEditedRef.current = true
    setSources((current) => (current.length === 1 ? current : current.filter((group) => group.id !== topicId)))
  }

  function removeUrl(topicId, urlId) {
    sourcesEditedRef.current = true
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

  function resolveConfigFileName() {
    const stamp = new Date().toISOString().slice(0, 10)
    let baseName = ''
    if (configSelectionType === 'new') {
      baseName = newConfigFileName
    } else if (configSelectionType === 'drive') {
      // En mode "drive" sempre sobreescriu el fitxer seleccionat.
      baseName = selectedConfigFileName || currentConfigFile?.name || ''
    } else {
      baseName = `faq-config-${stamp}.csv`
    }
    const trimmedName = baseName.trim()
    if (!trimmedName) return ''
    return trimmedName.toLowerCase().endsWith('.csv') ? trimmedName : `${trimmedName}.csv`
  }

  async function saveConfigToDrive({ silent = false } = {}) {
    const suggestedName = resolveConfigFileName()
    if (!suggestedName) return false
    const content = buildConfigCsvText()

    setSaveConfigBusy(true)
    if (!silent) setExportMessage('')
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
      if (configSelectionType === 'new') setNewConfigFileName(data.name || suggestedName)
      if (!silent) {
        setExportMessage(`Configuracio desada a Drive com ${data.name || suggestedName}.`)
        await loadFaqSheets()
      }
      return true
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : 'No s’ha pogut desar la configuració a Drive.')
      return false
    } finally {
      setSaveConfigBusy(false)
    }
  }

  useEffect(() => {
    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = null
    }

    if (!isGoogleConnected || configSelectionType === 'none') {
      setAutosaveStatus('idle')
      autosaveInitializedRef.current = false
      lastAutosaveKeyRef.current = ''
      return
    }

    const fileName = resolveConfigFileName()
    if (!fileName) {
      setAutosaveStatus('idle')
      return
    }

    if (configLoadInProgressRef.current) return
    if (!sourcesEditedRef.current) return
    if (!hasConfigContent(sources)) {
      setAutosaveStatus('idle')
      return
    }

    const autosaveKey = `${fileName}\n${buildConfigCsvText()}`
    if (!autosaveInitializedRef.current) {
      autosaveInitializedRef.current = true
      lastAutosaveKeyRef.current = autosaveKey
      setAutosaveStatus('saved')
      return
    }
    if (autosaveKey === lastAutosaveKeyRef.current) {
      return
    }

    setAutosaveStatus('saving')
    autosaveTimerRef.current = window.setTimeout(async () => {
      const saved = await saveConfigToDrive({ silent: true })
      if (saved) {
        lastAutosaveKeyRef.current = autosaveKey
        sourcesEditedRef.current = false
        setAutosaveStatus('saved')
      } else {
        setAutosaveStatus('error')
      }
      autosaveTimerRef.current = null
    }, 900)

    return () => {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current)
        autosaveTimerRef.current = null
      }
    }
  }, [isGoogleConnected, configSelectionType, newConfigFileName, currentConfigFile?.name, selectedConfigFileName, sources])

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

    const hasShareRecipients = shareRecipients.some((recipient) => recipient.value.trim())
    if (sheetSelectionMode === 'existing' && selectedFaqSpreadsheetId && hasShareRecipients) {
      const shared = await shareSelectedFaqFile()
      if (!shared) return
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

    const spreadsheetTitle = (sheetSelectionMode === 'new'
      ? newSpreadsheetTitle
      : selectedFaqSpreadsheetTitle).trim() || FIXED_SPREADSHEET_TITLE
    const spreadsheetId = sheetSelectionMode === 'existing' ? selectedFaqSpreadsheetId : ''
    const worksheetName = FIXED_WORKSHEET_NAME

    setDownloadBusy(true)
    appendActivityLog(`Exportant FAQs a Google Sheets: ${FIXED_DRIVE_PATH} / ${spreadsheetTitle}`)
    try {
      const response = await apiFetch(`${API_BASE}/api/jobs/${selectedJobId}/export/sheets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spreadsheet_title: spreadsheetTitle,
          spreadsheet_id: spreadsheetId || undefined,
          worksheet_name: worksheetName,
        }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.detail || `HTTP ${response.status}`)
      setExportMessage(`Resultat exportat a Google Sheets a ${FIXED_DRIVE_PATH}/${data.spreadsheet_title}. Fes la revisió i marca Estat=Aprovat al full.`)
      appendActivityLog(`Exportacio completada: ${FIXED_DRIVE_PATH} / ${data.spreadsheet_title}`)
      setLastAutoExportedJobId(selectedJobId)
      setSelectedFaqSpreadsheetTitle(data.spreadsheet_title || spreadsheetTitle)
      setSelectedFaqSpreadsheetId(data.spreadsheet_id || spreadsheetId)
      setSheetSelectionMode('existing')
      setNewSpreadsheetTitle('')
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
    setGeneratorNoApprovedFaqs(false)
    const formData = new FormData()
    formData.append('input_mode', 'sheets_oauth')

    if (!googleSession?.connected) {
      setExportMessage('Inicia sessió amb Google per generar l’HTML des del Sheet seleccionat.')
      return
    }

    const spreadsheetTitle = (sheetSelectionMode === 'new'
      ? newSpreadsheetTitle
      : selectedFaqSpreadsheetTitle).trim() || FIXED_SPREADSHEET_TITLE

    formData.append('spreadsheet_title', spreadsheetTitle)
    formData.append('worksheet_name', FIXED_WORKSHEET_NAME)

    setGeneratorCompleted(false)
    setGeneratorNoApprovedFaqs(false)
    setGeneratorApprovedRows(0)
    setGeneratorSubtopics(0)
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
      setGeneratorApprovedRows(Number(data?.approved_rows || 0))
      setGeneratorSubtopics(Number(data?.groups || 0))
      setGeneratorProgress(100)
      setGeneratorCompleted(true)
      setGeneratorMissingSheet(false)
      setGeneratorNoApprovedFaqs(false)
      setExportMessage('Codi HTML carregat des del document FAQ seleccionat.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No s’ha pogut generar l’HTML.'
      setLastGeneratedCode('')
      setGeneratorCompleted(false)
      setGeneratorApprovedRows(0)
      setGeneratorSubtopics(0)
      setGeneratorProgress(0)
      setGeneratorMissingSheet(message.includes("No s'ha trobat cap document"))
      setGeneratorNoApprovedFaqs(message.toLowerCase().includes('cap faq aprovada'))
      setExportMessage(message)
    } finally {
      window.setTimeout(() => {
        setGeneratorBusy(false)
      }, 220)
    }
  }

  async function publishToGenweb() {
    setGenwebPublishMessage('')
    setGenwebPublishError('')

    if (!lastGeneratedCode.trim()) {
      setGenwebPublishError('Primer has de generar el codi font HTML.')
      return
    }
    if (!isValidHttpUrl(genwebUrl)) {
      setGenwebPublishError('La URL de Genweb no es valida.')
      return
    }
    if (!genwebUsername.trim() || !genwebPassword) {
      setGenwebPublishError('Cal indicar usuari i contrasenya de Genweb.')
      return
    }

    setGenwebPublishBusy(true)
    try {
      const response = await apiFetch(`${API_BASE}/api/genweb/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_url: genwebUrl.trim(),
          html_text: lastGeneratedCode,
          username: genwebUsername.trim(),
          password: genwebPassword,
        }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.detail || `HTTP ${response.status}`)
      setGenwebPublishMessage(`Contingut publicat correctament a ${genwebUrl.trim()}.`)
      setGenwebPassword('')
    } catch (error) {
      setGenwebPublishError(error instanceof Error ? error.message : 'No s’ha pogut publicar a Genweb.')
    } finally {
      setGenwebPublishBusy(false)
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

  useEffect(() => {
    if (activeView !== 'export') return
    setLastGeneratedCode('')
    setGeneratorCompleted(false)
    setGeneratorBusy(false)
    setGeneratorProgress(0)
    setGeneratorMissingSheet(false)
    setGeneratorNoApprovedFaqs(false)
    setGeneratorApprovedRows(0)
    setGeneratorSubtopics(0)
    if (!exportStep1Enabled || !selectedFaqSpreadsheetId) {
      setExportStep(1)
    }
  }, [activeView, exportStep1Enabled, selectedFaqSpreadsheetId])

  useEffect(() => {
    if (activeView !== 'scrape') return
    setActivityLogs([])
    setJobResult(null)
    setSelectedJob(null)
    setSelectedJobId('')
    setScrapeVisualProgress(0)
    setLogsCollapsed(false)
    setLastAutoExportedJobId('')
  }, [activeView])

  const googleSessionPanel = (
    <aside className="panel side-panel google-session-panel">
      <div className="selected-sheet-card compact-side-card sidebar-unified-card account-card">
        <div className="compact-card-head">
          <div className="title-row-inline compact-inline-head">
            <img className="panel-icon google-badge inline" src={googleLogo} alt="" aria-hidden="true" />
            <strong>Compte Google</strong>
          </div>
        </div>
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
      {(activeView === 'scrape' || activeView === 'export') && (activeView === 'export' ? exportWorkflowMessage : workflowSidebarMessage) && (
        <div className="session-feedback-card">
          <p className="session-feedback-text">{activeView === 'export' ? exportWorkflowMessage : workflowSidebarMessage}</p>
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
                <div className={`scrape-locked-section${isGoogleConnected ? '' : ' is-locked'}`} aria-hidden={!isGoogleConnected}>
                  <div className="workflow-card-grid">
                    <div className="workflow-stepper" aria-label="Progrés de passos">
                      {workflowSteps.map((step) => (
                        <button
                          key={step.id}
                          type="button"
                          className={`workflow-step-pill${scrapeStep === step.id ? ' active' : ''}`}
                          onClick={() => goToScrapeStep(step.id)}
                          disabled={!step.enabled}
                          aria-current={scrapeStep === step.id ? 'step' : undefined}
                        >
                          {step.title}
                        </button>
                      ))}
                    </div>

                    {scrapeStep === 1 && (
                        <section className="workflow-card">
                          <div className="workflow-card-head">
                            <h3>Triar configuració</h3>
                          </div>
                          <div className="collapsible-region">
                            <div className="collapsible-region-inner">
                              <label className="field drive-select-field config-drive-field">
                                <div className="config-picker-row">
                                  <span className="field-with-help config-picker-label">
                                    <span>Carrega una configuració</span>
                                    <span className="inline-help">
                                      <span className="inline-help-trigger" aria-hidden="true">?</span>
                                      <span className="inline-help-popover">Es guarden i es carreguen des de: El meu Drive &gt; UPC &gt; FAQs &gt; Configuracions.</span>
                                    </span>
                                  </span>
                                  <select
                                    value={configPickerValue}
                                    onChange={(event) => {
                                      const nextId = event.target.value
                                      if (!nextId) {
                                        setSelectedConfigFileId('')
                                        setSelectedConfigFileName('')
                                        setConfigSelectionType('none')
                                        setNewConfigFileName('')
                                        setLoadedConfigSummaryFileId('')
                                        setLoadingConfigFileId('')
                                        setLoadedConfigStats({ fileId: '', topics: 0, urls: 0 })
                                        return
                                      }
                                      if (nextId === '__NEW__') {
                                        createNewConfiguration()
                                        return
                                      }

                                      const nextConfig = availableConfigFiles.find((item) => item.id === nextId)
                                      if (!nextConfig) return
                                      loadSelectedConfigFile(nextId, nextConfig.name).catch(() => {})
                                    }}
                                    disabled={!isGoogleConnected}
                                  >
                                    <option value="">Selecciona una configuració</option>
                                    <option value="__NEW__">Nova configuració</option>
                                    {availableConfigFiles.map((item) => (
                                      <option key={item.id} value={item.id}>{formatConfigDisplayName(item.name)}</option>
                                    ))}
                                  </select>
                                </div>
                              </label>
                              {configSelectionType === 'new' && (
                                <label className="field drive-select-field config-drive-field">
                                  <div className="config-picker-row">
                                    <span className="field-with-help config-picker-label">
                                      <span>Nom de la nova configuració</span>
                                    </span>
                                    <input
                                      type="text"
                                      value={newConfigFileName}
                                      onChange={(event) => setNewConfigFileName(event.target.value)}
                                      placeholder=""
                                      disabled={!isGoogleConnected}
                                    />
                                  </div>
                                </label>
                              )}
                              {configSelectionType === 'drive' && selectedConfigFileId && (
                                <div className="config-summary-box" role="status" aria-live="polite">
                                  {loadingConfigFileId === selectedConfigFileId
                                    ? 'Carregant URLs...'
                                    : `Carregades ${
                                      loadedConfigStats.fileId === selectedConfigFileId ? loadedConfigStats.urls : loadedConfigUrlsCount
                                    } URLs i ${
                                      loadedConfigStats.fileId === selectedConfigFileId ? loadedConfigStats.topics : loadedConfigTopicsCount
                                    } topics.`}
                                </div>
                              )}
                            </div>
                          </div>
                        </section>
                    )}

                    {scrapeStep === 2 && (
                        <section className={`workflow-card sheet-selection-card${sheetStepEnabled ? '' : ' is-disabled'}`}>
                          <div className="workflow-card-head">
                            <h3>Triar fitxer Sheets</h3>
                          </div>
                          <div className="collapsible-region">
                            <div className="collapsible-region-inner sheet-choice-stack">
                              <label className="field drive-select-field config-drive-field">
                                <div className="config-picker-row">
                                  <span className="field-with-help config-picker-label">
                                    <span>Carrega un Google Sheets</span>
                                    <span className="inline-help">
                                      <span className="inline-help-trigger" aria-hidden="true">?</span>
                                      <span className="inline-help-popover">Ruta FAQs per defecte: {FIXED_DRIVE_PATH}</span>
                                    </span>
                                  </span>
                                  <select
                                    value={sheetSelectionMode === 'new' ? '__NEW__' : selectedFaqSpreadsheetId}
                                    onChange={(event) => {
                                      const nextId = event.target.value
                                      if (!nextId) {
                                        setSheetSelectionMode('')
                                        setSelectedFaqSpreadsheetId('')
                                        setNewSpreadsheetTitle('')
                                        return
                                      }
                                      if (nextId === '__NEW__') {
                                        setSheetSelectionMode('new')
                                        setSelectedFaqSpreadsheetId('')
                                        setNewSpreadsheetTitle(selectedFaqSpreadsheetTitle || FIXED_SPREADSHEET_TITLE)
                                        return
                                      }
                                      const nextSheet = availableFaqSheets.find((item) => item.id === nextId)
                                      setSelectedFaqSpreadsheetId(nextId)
                                      setSelectedFaqSpreadsheetTitle(nextSheet?.name || FIXED_SPREADSHEET_TITLE)
                                      setSheetSelectionMode('existing')
                                      setNewSpreadsheetTitle('')
                                    }}
                                    disabled={!sheetStepEnabled || driveListBusy}
                                  >
                                    <option value="">Selecciona un sheets</option>
                                    <option value="__NEW__">Sheet nou</option>
                                    {availableFaqSheets.map((item) => (
                                      <option key={item.id} value={item.id}>{item.name}</option>
                                    ))}
                                  </select>
                                </div>
                              </label>
                              {sheetSelectionMode === 'new' && (
                                <label className="field drive-select-field config-drive-field">
                                  <div className="config-picker-row">
                                    <span className="field-with-help config-picker-label">
                                      <span>Nom del nou Google Sheet</span>
                                      <span className="inline-help">
                                        <span className="inline-help-trigger" aria-hidden="true">?</span>
                                        <span className="inline-help-popover">Es desarà a: {FIXED_DRIVE_PATH}</span>
                                      </span>
                                    </span>
                                    <input
                                      type="text"
                                      value={newSpreadsheetTitle}
                                      onChange={(event) => {
                                        setNewSpreadsheetTitle(event.target.value)
                                        setSelectedFaqSpreadsheetTitle(event.target.value)
                                      }}
                                      placeholder={FIXED_SPREADSHEET_TITLE}
                                      disabled={!sheetStepEnabled}
                                    />
                                  </div>
                                </label>
                              )}
                              {sheetSelectionMode === 'existing' && selectedFaqSpreadsheetId && (
                                <div className="config-summary-box" role="status" aria-live="polite">
                                  {loadingSheetStatsId === selectedFaqSpreadsheetId
                                    ? 'Carregant FAQs...'
                                    : `${selectedSheetStats.spreadsheetId === selectedFaqSpreadsheetId ? selectedSheetStats.totalFaqs : 0} FAQs trobades ja disponibles en aquest arxiu.`}
                                </div>
                              )}
                            </div>
                          </div>
                        </section>
                    )}

                    {scrapeStep === 3 && (
                        <section className={`workflow-card share-step-card${shareStepEnabled ? '' : ' is-disabled'}`}>
                          <div className="workflow-card-head">
                            <h3>Vols compartir el fitxer?</h3>
                          </div>
                          <div className="collapsible-region">
                            <div className="collapsible-region-inner">
                              <div className="sheet-share-block">
                                <div className="share-recipient-list">
                                  {shareRecipients.map((recipient, index) => (
                                    <div key={recipient.id} className="share-recipient-row">
                                      <input
                                        type="email"
                                        value={recipient.value}
                                        onChange={(event) => updateShareRecipient(recipient.id, event.target.value)}
                                        placeholder={`Correu ${index + 1}`}
                                        disabled={!shareStepEnabled}
                                      />
                                      {shareRecipients.length > 1 && (
                                        <button type="button" className="ghost compact-ghost" onClick={() => removeShareRecipient(recipient.id)} disabled={!shareStepEnabled}>
                                          -
                                        </button>
                                      )}
                                    </div>
                                  ))}
                                </div>
                                <div className="share-action-row">
                                  <button type="button" className="share-add-button" onClick={addShareRecipient} disabled={!shareStepEnabled}>Afegir persona</button>
                                </div>
                              </div>
                              {selectedFaqSpreadsheetId && (
                                <div className="config-summary-box share-summary-box" role="status" aria-live="polite">
                                  {loadingSheetShareId === selectedFaqSpreadsheetId
                                    ? 'Comprovant comparticions...'
                                    : (() => {
                                        const isCurrent = selectedSheetShareInfo.spreadsheetId === selectedFaqSpreadsheetId
                                        const peopleCount = isCurrent ? selectedSheetShareInfo.sharedPeopleCount : 0
                                        const names = isCurrent && selectedSheetShareInfo.sharedPeople.length
                                          ? ` ${selectedSheetShareInfo.sharedPeople.join(', ')}.`
                                          : ''
                                        if (peopleCount === 0) {
                                          return "Actualment l'arxiu no s'esta compartint amb ningu."
                                        }
                                        return `Actualment l'arxiu esta sent compartit amb${names}`
                                      })()}
                                </div>
                              )}
                            </div>
                          </div>
                        </section>
                    )}

                    {scrapeStep === 4 && (
                        <section className={`workflow-card${downloaderStepEnabled ? '' : ' is-disabled'}`}>
                          <div className="workflow-card-head">
                            <h3>Descarregador</h3>
                          </div>
                          <div className="collapsible-region">
                            <div className="collapsible-region-inner">
                          <div className="topic-stack">
                            {sources.map((group, index) => (
                              <section key={group.id} className="topic-card">
                                <div className="topic-head">
                                  <div className="topic-main-row">
                                    <span className="row-key">Topic</span>
                                    <input
                                      type="text"
                                      value={group.topic}
                                      onChange={(event) => updateTopic(group.id, 'topic', event.target.value)}
                                      disabled={!downloaderStepEnabled}
                                    />
                                  </div>
                                  <div className="inline-action-group">
                                    <button type="button" className="secondary inline-soft-action plus-action" onClick={addTopic} aria-label="Afegir topic" title="Afegir topic" disabled={!downloaderStepEnabled}>+</button>
                                    {sources.length > 1 && (
                                      <button type="button" className="ghost inline-soft-action plus-action" onClick={() => removeTopic(group.id)} aria-label="Eliminar topic" title="Eliminar topic" disabled={!downloaderStepEnabled}>-</button>
                                    )}
                                  </div>
                                </div>

                                {group.urls.map((url, urlIndex) => (
                                  <div key={url.id} className="url-row">
                                    <span className="row-key">URL</span>
                                    <input
                                      type="url"
                                      value={url.value}
                                      onChange={(event) => updateTopic(group.id, url.id, { value: event.target.value })}
                                      disabled={!downloaderStepEnabled}
                                    />
                                    <label className="url-toggle">
                                      <input
                                        type="checkbox"
                                        checked={url.enabled !== false}
                                        onChange={(event) => updateTopic(group.id, url.id, { enabled: event.target.checked })}
                                        disabled={!downloaderStepEnabled}
                                      />
                                      <span>{url.enabled !== false ? 'Activa' : 'Pausada'}</span>
                                    </label>
                                    <div className="inline-action-group">
                                      {urlIndex === group.urls.length - 1 && (
                                        <button type="button" className="secondary inline-soft-action plus-action" onClick={() => addUrl(group.id)} aria-label="Afegir URL" title="Afegir URL" disabled={!downloaderStepEnabled}>+</button>
                                      )}
                                      {group.urls.length > 1 && (
                                        <button type="button" className="ghost inline-soft-action plus-action" onClick={() => removeUrl(group.id, url.id)} aria-label="Eliminar URL" title="Eliminar URL" disabled={!downloaderStepEnabled}>-</button>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </section>
                            ))}
                          </div>
                          <div className="action-bar">
                            <div className="action-inline-group">
                              {isGoogleConnected ? (
                                <>
                                  <button type="button" onClick={startScrape} disabled={isScrapeBusy || !downloaderStepEnabled}>{isScrapeBusy ? 'Descarregant...' : 'Descarregar FAQs'}</button>
                                  {configSelectionType !== 'none' && (
                                    <span className={`autosave-pill ${autosaveStatus}`}>
                                      {autosaveStatus === 'saving'
                                        ? 'Autosave: guardant...'
                                        : (autosaveStatus === 'error' ? 'Autosave: error' : 'Autosave: desat')}
                                    </span>
                                  )}
                                  {showScrapeInlineProgress && (
                                    <div className="mini-progress-row">
                                      <div className="mini-progress" aria-live="polite" aria-label={`Descarregant FAQs, ${scrapeInlineProgress}%`}>
                                        <div className="mini-progress-bar">
                                          <span style={{ width: `${scrapeInlineProgress}%` }} />
                                        </div>
                                        <strong>{`${scrapeInlineProgress}%`}</strong>
                                      </div>
                                    </div>
                                  )}
                                </>
                              ) : (
                                <p className="scrape-login-warning">No has iniciat sessio de Google. Connecta&apos;t per descarregar FAQs.</p>
                              )}
                            </div>
                          </div>
                          {showDownloadSuccessBanner && (
                            <div className="download-success-banner" role="status" aria-live="polite">
                              {`${completedFaqCount} FAQs descarregades a ${exportedSpreadsheetLabel}, s'ha desat aquesta configuracio a ${savedConfigLabel}.`}
                            </div>
                          )}
                          {hasInvalidUrlsInForm && (
                            <div className="download-error-banner" role="alert" aria-live="assertive">
                              {invalidSources.length === 1 ? 'URL no vàlida.' : 'URLs no vàlides.'}
                            </div>
                          )}
                          {hasNoFaqsAnywhere && (
                            <div className="download-error-banner" role="alert" aria-live="assertive">
                              No s&apos;han trobat FAQs en aquestes URLs.
                            </div>
                          )}
                          {hasPartialNoFaqs && (
                            <div className="download-error-banner" role="alert" aria-live="assertive">
                              {`No s'han trobat FAQs a: ${urlsWithoutFaqs.join(', ')}`}
                            </div>
                          )}
                          {isGoogleConnected && downloaderStepEnabled && (
                            <div
                              className="logs-collapsible-card"
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
                                  <pre>{visibleLogs.join('\n') || 'Sense logs encara.'}</pre>
                                </div>
                              </div>
                            </div>
                          )}
                            </div>
                          </div>
                        </section>
                    )}

                    <div className="workflow-step-actions">
                      {scrapeStep !== 1 ? (
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => goToScrapeStep(scrapeStep - 1)}
                        >
                          Pas anterior
                        </button>
                      ) : <span aria-hidden="true" />}
                      <button
                        type="button"
                        className="next-step-button"
                        onClick={() => {
                          if (scrapeStep === 4) {
                            resetScrapeWorkflow()
                            return
                          }
                          setScrapeStep((current) => Math.min(4, current + 1))
                        }}
                        disabled={scrapeStep === 4 ? false : !canGoNextStep}
                      >
                        {scrapeStep === 4 ? 'Tornar a l\'inici' : 'Següent pas'}
                      </button>
                    </div>
                  </div>
                </div>
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
                <div className="workflow-stepper" aria-label="Progrés exportació">
                  <button type="button" className={`workflow-step-pill${exportStep === 1 ? ' active' : ''}`} onClick={() => setExportStep(1)} disabled={!exportStep1Enabled}>
                    Pas 1: Arxiu FAQ
                  </button>
                  <button type="button" className={`workflow-step-pill${exportStep === 2 ? ' active' : ''}`} onClick={() => { if (canGoNextExportStep) setExportStep(2) }} disabled={!exportStep2Enabled}>
                    Pas 2: Generar codi
                  </button>
                  <button type="button" className={`workflow-step-pill${exportStep === 3 ? ' active' : ''}`} onClick={() => { if (exportStep3Enabled) setExportStep(3) }} disabled={!exportStep3Enabled}>
                    Pas 3: Penjar a Genweb
                  </button>
                </div>

                <article className={`panel export-primary-card${(exportStep === 1 && !exportStep1Enabled) || (exportStep === 2 && !exportStep2Enabled) || (exportStep === 3 && !exportStep3Enabled) ? ' is-disabled' : ''}`}>
                  <div className="workflow-card-head">
                    {exportStep === 1 && <h3>Tria l’arxiu amb les FAQs per convertir</h3>}
                    {exportStep === 2 && <h3>Generador de codi font</h3>}
                    {exportStep === 3 && <h3>Publicació a Genweb</h3>}
                    {exportStep === 2 && (
                      <div className="generator-head-actions">
                        {!generatorMissingSheet && (generatorBusy || generatorCompleted) && (
                          <div className="mini-progress-row">
                            <div className="mini-progress" aria-live="polite" aria-label={`Generant codi, ${generatorProgress}%`}>
                              <div className="mini-progress-bar">
                                <span style={{ width: `${generatorProgress}%` }} />
                              </div>
                              <strong>{`${generatorProgress}%`}</strong>
                            </div>
                          </div>
                        )}
                        {generatorCompleted ? (
                          <span className="generate-done-pill" role="status" aria-live="polite">✓ Generat</span>
                        ) : (
                          <button type="button" className="generate-action-button" onClick={generateHtmlFromExternalSource} disabled={!exportStep2Enabled || generatorBusy || !selectedFaqSpreadsheetId}>
                            {generatorBusy ? 'Generant...' : 'Generar'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {exportStep === 1 ? (
                    <>
                      <label className="field drive-select-field config-drive-field">
                        <div className="config-picker-row">
                          <span className="field-with-help config-picker-label">
                            <span>Tria arxiu FAQ</span>
                            <span className="inline-help">
                              <span className="inline-help-trigger" aria-hidden="true">?</span>
                              <span className="inline-help-popover">Selecciona el Google Sheet de FAQs que vols convertir a codi font. Ruta: El meu Drive &gt; UPC &gt; FAQs.</span>
                            </span>
                          </span>
                          <select
                            value={selectedFaqSpreadsheetId}
                            onChange={(event) => {
                              const nextId = event.target.value
                              const nextSheet = availableFaqSheets.find((item) => item.id === nextId)
                              setSelectedFaqSpreadsheetId(nextId)
                              setSelectedFaqSpreadsheetTitle(nextSheet?.name || FIXED_SPREADSHEET_TITLE)
                            }}
                            disabled={!exportStep1Enabled || driveListBusy || !availableFaqSheets.length}
                          >
                            {!availableFaqSheets.length ? (
                              <option value="">No hi ha fitxers disponibles</option>
                            ) : (
                              <>
                                <option value="">Selecciona un arxiu FAQ</option>
                                {availableFaqSheets.map((item) => (
                                  <option key={item.id} value={item.id}>{item.name}</option>
                                ))}
                              </>
                            )}
                          </select>
                        </div>
                      </label>
                      {selectedFaqSpreadsheetId && (
                        <div className="config-summary-box" role="status" aria-live="polite">
                          {loadingSheetStatsId === selectedFaqSpreadsheetId
                            ? 'Carregant FAQs...'
                            : `Carregat amb ${selectedSheetStats.spreadsheetId === selectedFaqSpreadsheetId ? selectedSheetStats.totalFaqs : 0} FAQs, de les quals ${selectedSheetStats.spreadsheetId === selectedFaqSpreadsheetId ? selectedSheetStats.approvedFaqs : 0} estan aprovades.`}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="action-stack">
                      {isGoogleConnected ? (
                        <>
                          {generatorMissingSheet && (
                            <div className="generator-error-box" role="alert">
                              No hi ha cap arxiu Excel amb FAQs.
                            </div>
                          )}
                        </>
                      ) : (
                        <p className="scrape-login-warning">No has iniciat sessió de Google. Connecta't per generar el codi font.</p>
                      )}
                    </div>
                  )}

                  {exportStep === 2 && (
                    <div className="export-code-inline">
                      {generatorCompleted && (
                        <div className="download-success-banner" role="status" aria-live="polite">
                          {`Generat codi font amb ${generatorApprovedRows} faqs aprobades i ${generatorSubtopics} subtopics.`}
                        </div>
                      )}
                      {generatorNoApprovedFaqs && (
                        <div className="download-error-banner" role="alert" aria-live="assertive">
                          No s&apos;ha trobat cap faq aprobada.
                        </div>
                      )}
                      <pre className="code-block">{lastGeneratedCode || 'Encara no s’ha generat cap HTML.'}</pre>
                    </div>
                  )}

                  {exportStep === 3 && (
                    <div className="export-code-inline">
                      <label className="field field-inline">
                        <span>URL de la pàgina FAQ</span>
                        <input
                          type="url"
                          value={genwebUrl}
                          onChange={(event) => setGenwebUrl(event.target.value)}
                        />
                      </label>
                      <label className="field field-inline">
                        <span>Usuari Genweb</span>
                        <input
                          type="text"
                          value={genwebUsername}
                          onChange={(event) => setGenwebUsername(event.target.value)}
                        />
                      </label>
                      <label className="field field-inline">
                        <span>Contrasenya Genweb</span>
                        <input
                          type="password"
                          value={genwebPassword}
                          onChange={(event) => setGenwebPassword(event.target.value)}
                        />
                      </label>
                      {genwebPublishMessage && (
                        <div className="download-success-banner" role="status" aria-live="polite">
                          {genwebPublishMessage}
                        </div>
                      )}
                      {genwebPublishError && (
                        <div className="download-error-banner" role="alert" aria-live="assertive">
                          {genwebPublishError}
                        </div>
                      )}
                    </div>
                  )}

                </article>
                {exportStep === 1 && (
                  <div className="workflow-step-actions">
                    <span aria-hidden="true" />
                    <button type="button" className="next-step-button" onClick={() => setExportStep(2)} disabled={!canGoNextExportStep}>
                      Següent pas
                    </button>
                  </div>
                )}
                {exportStep === 2 && (
                  <div className="workflow-step-actions">
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setExportStep(1)}
                    >
                      Pas anterior
                    </button>
                    <button type="button" className="next-step-button" onClick={() => setExportStep(3)} disabled={!exportStep3Enabled}>
                      Següent pas
                    </button>
                  </div>
                )}
                {exportStep === 3 && (
                  <div className="workflow-step-actions">
                    <div className="export-step3-actions">
                      <div className="export-step3-actions-left">
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => setExportStep(2)}
                        >
                          Pas anterior
                        </button>
                        <button type="button" className="secondary" onClick={() => setExportStep(1)} disabled={!exportStep1Enabled}>
                          Tornar a l&apos;inici
                        </button>
                      </div>
                      <button type="button" onClick={publishToGenweb} disabled={genwebPublishBusy || !lastGeneratedCode.trim()}>
                        {genwebPublishBusy ? 'Publicant...' : 'Publicar ara'}
                      </button>
                    </div>
                  </div>
                )}
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

