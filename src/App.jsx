import { useEffect, useMemo, useRef, useState } from 'react'
import './styles.css'
import { loadState, saveState } from './lib/storage'
import { listCurrencies, getRate, formatMoney } from './lib/fx'

const DEFAULTS = {
  balance: '',
  srcCurrency: 'EUR',
  dstCurrency: 'USD',
  paydate: '',
  useConversion: false, // Changed default to false for better UX
  provider: 'frankfurter',
  apiKey: '',
  lastRate: null,
  cachedCurrencies: null // Added for caching currencies
}

function nextMonthFifteenthISO() {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  const d15next = new Date(y, m + 1, 15, 23, 59, 59)
  const yyyy = d15next.getFullYear()
  const mm = String(d15next.getMonth() + 1).padStart(2, '0')
  const dd = String(d15next.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export default function App(){
  const [currencies, setCurrencies] = useState([])
  const [currenciesLoading, setCurrenciesLoading] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [currencyPickerOpen, setCurrencyPickerOpen] = useState(false)
  const [currencyPickerType, setCurrencyPickerType] = useState('src') // 'src' or 'dst'
  const [isOnline, setIsOnline] = useState(navigator.onLine)

  const [state, setState] = useState(() => {
    const s = { ...DEFAULTS, ...loadState() }
    if (!s.paydate) s.paydate = nextMonthFifteenthISO()
    return s
  })

  // persist state
  useEffect(() => { 
    saveState(state) 
  }, [state])

  // monitor online status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  // load currency list
  useEffect(() => {
    async function loadCurrencies() {
      try {
        // Try to load from cache first
        if (state.cachedCurrencies && state.cachedCurrencies.length > 0) {
          setCurrencies(state.cachedCurrencies)
          setCurrenciesLoading(false)
        }
        
        // Try to fetch fresh data if online
        if (isOnline) {
          const freshCurrencies = await listCurrencies()
          setCurrencies(freshCurrencies)
          // Cache the currencies
          setState(s => ({ ...s, cachedCurrencies: freshCurrencies }))
        }
      } catch (error) {
        console.error('Failed to load currencies:', error)
        // If we have cached currencies, use them
        if (state.cachedCurrencies && state.cachedCurrencies.length > 0) {
          setCurrencies(state.cachedCurrencies)
        }
      } finally {
        setCurrenciesLoading(false)
      }
    }
    
    loadCurrencies()
  }, [isOnline])

  // install prompt (Android / desktop PWA)
  useEffect(() => {
    let deferred = null
    const handler = (e) => {
      e.preventDefault()
      deferred = e
      const btn = document.getElementById('install-btn')
      if (btn) {
        btn.hidden = false
        btn.onclick = async () => {
          btn.hidden = true
          deferred.prompt()
          await deferred.userChoice
          deferred = null
        }
      }
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  // register service worker
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/src/sw.js').catch(console.error)
    }
  }, [])

  // derived calculations
  const { perDay, daysLeft, amountDisplay, convertedDisplay, rateLine, error } = useMemo(() => {
    const out = { perDay: null, daysLeft: 0, amountDisplay: null, convertedDisplay: null, rateLine: '', error: '' }
    const balance = Number(state.balance || 0)
    if (!balance || !state.paydate) return out

    const now = new Date()
    const pay = new Date(state.paydate + 'T23:59:59')
    const ms = pay - now
    const day = 24 * 60 * 60 * 1000
    const days = Math.ceil(ms / day)
    
    if (days <= 0) {
      out.error = 'Choose a future payday.'
      return out
    }
    out.daysLeft = days

    // Original amount and per day in source currency
    out.amountDisplay = formatMoney(balance, state.srcCurrency)
    const originalPerDay = balance / days

    // If conversion is enabled and we have a valid rate, show converted amounts
    if (state.useConversion && state.srcCurrency !== state.dstCurrency && state.lastRate && 
        state.lastRate.from === state.srcCurrency && state.lastRate.to === state.dstCurrency) {
      const convertedAmount = balance * state.lastRate.value
      const convertedPerDay = convertedAmount / days
      out.convertedDisplay = formatMoney(convertedAmount, state.dstCurrency)
      out.perDay = convertedPerDay // This will be displayed in destination currency
      
      const rateAge = Date.now() - state.lastRate.timestamp
      const isStale = rateAge > 24 * 60 * 60 * 1000 // 24 hours
      out.rateLine = `1 ${state.srcCurrency} = ${state.lastRate.value.toFixed(4)} ${state.dstCurrency}${isStale ? ' (cached)' : ''}`
    } else {
      // No conversion - use original currency
      out.perDay = originalPerDay
    }

    return out
  }, [state])

  // Auto-fetch rates
  const fetchRateRef = useRef(false)
  useEffect(() => {
    if (fetchRateRef.current) return
    fetchRateRef.current = true
    maybeFetchRate()
  }, [])

  useEffect(() => {
    maybeFetchRate()
  }, [state.useConversion, state.srcCurrency, state.dstCurrency, state.provider, state.apiKey, isOnline])

  async function maybeFetchRate(){
    if (!isOnline) return // Don't fetch if offline
    if (!(state.useConversion && state.srcCurrency !== state.dstCurrency)) return
    
    // Check if we have a recent rate (less than 1 hour old)
    if (state.lastRate && state.lastRate.from === state.srcCurrency && 
        state.lastRate.to === state.dstCurrency &&
        (Date.now() - state.lastRate.timestamp) < 60 * 60 * 1000) {
      return // Use cached rate
    }
    
    try {
      const r = await getRate(state.srcCurrency, state.dstCurrency, state.provider, state.apiKey)
      setState(s => ({ ...s, lastRate: { ...r, from: s.srcCurrency, to: s.dstCurrency } }))
    } catch (e) {
      console.warn('Rate fetch failed:', e)
    }
  }

  function onChange(k, v){ 
    setState(s => ({ ...s, [k]: v })) 
  }

  function openCurrencyPicker(type) {
    setCurrencyPickerType(type)
    setCurrencyPickerOpen(true)
  }

  function selectCurrency(code) {
    if (currencyPickerType === 'src') {
      onChange('srcCurrency', code)
    } else {
      onChange('dstCurrency', code)
    }
    setCurrencyPickerOpen(false)
  }

  const displayCurrency = (state.useConversion && state.srcCurrency !== state.dstCurrency && state.lastRate) ? state.dstCurrency : state.srcCurrency

  return (
    <div className="app">
      {/* Header */}
      <div className="app-header">
        <h1 className="app-title">DailySpend</h1>
        <div className="header-controls">
          {!isOnline && (
            <div className="offline-indicator">
              Offline
            </div>
          )}
          <button
            onClick={() => setSettingsOpen(true)}
            className="settings-btn"
            aria-label="Open settings"
          >
            ⚙️
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="main-content">
        
        {/* Result Display */}
        <div className="result-card">
          {error ? (
            <div className="error-message">
              {error}
            </div>
          ) : perDay && daysLeft ? (
            <>
              <div className="amount-display">
                <div className="big-number">
                  {perDay ? Number(perDay).toLocaleString(undefined, { 
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 2 
                  }) : '0'}
                </div>
                <div className="currency-label">
                  {displayCurrency}
                </div>
              </div>
              <div className="result-subtitle">
                Daily spending budget
              </div>
              <div className={`result-meta ${convertedDisplay ? 'with-conversion' : ''}`}>
                {daysLeft} day{daysLeft !== 1 ? 's' : ''} left until payday
              </div>
              {convertedDisplay && (
                <div className="conversion-info">
                  Total: {convertedDisplay} • {rateLine}
                </div>
              )}
            </>
          ) : (
            <div className="placeholder-text">
              Enter your balance and payday to get started
            </div>
          )}
        </div>

        {/* Balance and Payday - Side by side */}
        <div className="input-row-container">
          {/* Balance Input */}
          <div className="glass-card half-width">
            <label className="field-label">
              Balance
            </label>
            <div className="input-row">
              <input
                type="number"
                inputMode="decimal"
                placeholder="0.00"
                value={state.balance}
                onChange={e => onChange('balance', e.target.value)}
                className="main-input"
              />
              <button
                onClick={() => openCurrencyPicker('src')}
                className="currency-btn"
                disabled={currenciesLoading}
              >
                {currenciesLoading ? 'Loading...' : state.srcCurrency}
              </button>
            </div>
          </div>

          {/* Payday */}
          <div className="glass-card half-width">
            <label className="field-label">
              Payday
            </label>
            <input
              type="date"
              value={state.paydate}
              onChange={e => onChange('paydate', e.target.value)}
              className="date-input"
            />
          </div>
        </div>

        {/* Currency Conversion Toggle */}
        <div className={`glass-card conversion-card ${state.useConversion ? 'active' : 'inactive'}`}>
          <div className="currency-toggle">
            <div className="toggle-left">
              <div className="toggle-content">
                <span className="toggle-text">
                  Display in different currency
                </span>
                <div className="toggle-subtitle">
                  {state.useConversion ? `Converting to ${state.dstCurrency}` : 'Conversion disabled'}
                </div>
              </div>
            </div>
            <div className="toggle-right">
              <button
                onClick={() => openCurrencyPicker('dst')}
                className={`currency-select-btn ${state.useConversion ? '' : 'disabled'}`}
                disabled={!state.useConversion || currenciesLoading}
              >
                {currenciesLoading ? '...' : state.dstCurrency}
              </button>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={state.useConversion}
                  onChange={e => onChange('useConversion', e.target.checked)}
                />
                <span className={`toggle-slider ${state.useConversion ? 'active' : ''}`}></span>
              </label>
            </div>
          </div>
        </div>

        {/* PWA Install Button */}
        <div className="install-section">
          <button 
            id="install-btn" 
            hidden
            className="install-btn"
          >
            Install App
          </button>
          <div className="install-hint">
            On iPhone: Share → "Add to Home Screen"
          </div>
        </div>
      </div>

      {/* Currency Picker Modal */}
      {currencyPickerOpen && (
        <div className="modal-overlay" onClick={() => setCurrencyPickerOpen(false)}>
          <div className="modal-panel picker" onClick={e => e.stopPropagation()}>
            <div className="modal-handle"></div>
            <h3 className="modal-title">
              Select Currency
            </h3>
            <div className="currency-list">
              {currencies.map(([code, name]) => (
                <button
                  key={code}
                  onClick={() => selectCurrency(code)}
                  className="currency-item"
                >
                  <span className="currency-code">{code}</span> — {name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {settingsOpen && (
        <div className="modal-overlay" onClick={() => setSettingsOpen(false)}>
          <div className="modal-panel settings" onClick={e => e.stopPropagation()}>
            <div className="modal-handle"></div>
            <h3 className="modal-title">
              Settings
            </h3>

            <div className="settings-field">
              <label className="settings-label">
                Exchange Rate Provider
              </label>
              <select
                value={state.provider}
                onChange={e => onChange('provider', e.target.value)}
                className="settings-select"
              >
                <option value="frankfurter">Frankfurter (Free, No Key)</option>
                <option value="exchangerate-host">ExchangeRate.host (Free Tier + Key)</option>
              </select>
              <small className="settings-hint">
                Frankfurter uses ECB daily reference rates
              </small>
            </div>

            {state.provider === 'exchangerate-host' && (
              <div className="settings-field">
                <label className="settings-label">
                  API Key
                </label>
                <input
                  type="text"
                  placeholder="Enter your API key"
                  value={state.apiKey}
                  onChange={e => onChange('apiKey', e.target.value)}
                  className="settings-input"
                />
              </div>
            )}

            <div className="settings-actions">
              <button
                onClick={() => {
                  if (confirm('Are you sure you want to clear all data?')) {
                    localStorage.clear()
                    location.reload()
                  }
                }}
                className="btn-danger"
              >
                Clear Data
              </button>
              <button
                onClick={() => setSettingsOpen(false)}
                className="btn-primary"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}