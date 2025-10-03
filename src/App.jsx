import { useEffect, useMemo, useRef, useState } from 'react'
import './styles.css'
import SettingsIcon from './components/SettingsIcon'
import { loadState, saveState } from './lib/storage'
import { listCurrencies, getRate, formatMoney } from './lib/fx'

const DEFAULTS = {
  balance: '',
  srcCurrency: 'EUR',
  dstCurrency: 'USD',
  paydate: '',
  useConversion: false,
  provider: 'frankfurter',
  apiKey: '',
  lastRate: null,
  cachedCurrencies: null,
  lastPerDay: null // Store last calculated per day amount
}

function nextMonthFifteenthISO() {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  const d = now.getDate()
  
  // If we haven't passed the 15th yet this month, use current month
  const targetMonth = d < 15 ? m : m + 1
  const d15next = new Date(y, targetMonth, 15, 23, 59, 59)
  
  const yyyy = d15next.getFullYear()
  const mm = String(d15next.getMonth() + 1).padStart(2, '0')
  const dd = String(d15next.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function formatNumberWithCommas(value) {
  if (!value) return ''
  // Remove non-numeric characters except decimal point
  const cleaned = value.toString().replace(/[^\d.]/g, '')
  const parts = cleaned.split('.')
  // Add thousand separators
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  // Limit decimals to 2 places
  if (parts[1]) {
    parts[1] = parts[1].substring(0, 2)
  }
  return parts.join('.')
}

export default function App(){
  const [currencies, setCurrencies] = useState([])
  const [currenciesLoading, setCurrenciesLoading] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [currencyPickerOpen, setCurrencyPickerOpen] = useState(false)
  const [currencyPickerType, setCurrencyPickerType] = useState('src')
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [isStandalone, setIsStandalone] = useState(false)
  const [animatedValue, setAnimatedValue] = useState(null)

  const [state, setState] = useState(() => {
    const s = { ...DEFAULTS, ...loadState() }
    if (!s.paydate) s.paydate = nextMonthFifteenthISO()
    return s
  })

  // Check if running as standalone PWA
  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches ||
                      window.navigator.standalone === true ||
                      document.referrer.includes('android-app://')
    setIsStandalone(standalone)
  }, [])

  // persist state
  useEffect(() => { 
    saveState(state) 
  }, [state])

  // handle iOS viewport height
  useEffect(() => {
    function setVH() {
      let vh = window.innerHeight * 0.01;
      document.documentElement.style.setProperty('--vh', `${vh}px`);
    }
    
    setVH(); // Set initial value
    window.addEventListener('load', setVH);
    window.addEventListener('resize', setVH);
    window.addEventListener('orientationchange', setVH);
    
    let lastWidth = window.innerWidth;
    const resizeHandler = () => {
      // Only update on width changes to avoid iOS Safari address bar triggers
      if (lastWidth !== window.innerWidth) {
        lastWidth = window.innerWidth;
        setVH();
      }
    };
    
    window.addEventListener('resize', resizeHandler);
    
    return () => {
      window.removeEventListener('load', setVH);
      window.removeEventListener('resize', setVH);
      window.removeEventListener('orientationchange', setVH);
      window.removeEventListener('resize', resizeHandler);
    };
  }, []);

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
        if (state.cachedCurrencies && state.cachedCurrencies.length > 0) {
          setCurrencies(state.cachedCurrencies)
          setCurrenciesLoading(false)
        }
        
        if (isOnline) {
          const freshCurrencies = await listCurrencies()
          setCurrencies(freshCurrencies)
          setState(s => ({ ...s, cachedCurrencies: freshCurrencies }))
        }
      } catch (error) {
        console.error('Failed to load currencies:', error)
        if (state.cachedCurrencies && state.cachedCurrencies.length > 0) {
          setCurrencies(state.cachedCurrencies)
        }
      } finally {
        setCurrenciesLoading(false)
      }
    }
    
    loadCurrencies()
  }, [isOnline])

  // install prompt
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
      navigator.serviceWorker.register('/dailyspend/sw.js').catch(console.error)
    }
  }, [])

  // derived calculations
  const { perDay, daysLeft, amountDisplay, convertedDisplay, rateLine, error } = useMemo(() => {
    const out = { perDay: null, daysLeft: 0, amountDisplay: null, convertedDisplay: null, rateLine: '', error: '' }
    const balance = Number(state.balance?.replace(/,/g, '') || 0)
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

    out.amountDisplay = formatMoney(balance, state.srcCurrency)
    const originalPerDay = Math.floor(balance / days)

    if (state.useConversion && state.srcCurrency !== state.dstCurrency && state.lastRate && 
        state.lastRate.from === state.srcCurrency && state.lastRate.to === state.dstCurrency) {
      const convertedAmount = balance * state.lastRate.value
      const convertedPerDay = Math.floor(convertedAmount / days)
      out.convertedDisplay = formatMoney(convertedAmount, state.dstCurrency)
      out.perDay = convertedPerDay
      
      const rateAge = Date.now() - state.lastRate.timestamp
      const isStale = rateAge > 24 * 60 * 60 * 1000
      out.rateLine = `1 ${state.srcCurrency} = ${state.lastRate.value.toFixed(4)} ${state.dstCurrency}${isStale ? ' (cached)' : ''}`
    } else {
      out.perDay = originalPerDay
    }

    return out
  }, [state])

  // Animate number changes
  useEffect(() => {
    if (perDay !== null && perDay !== undefined) {
      const lastValue = state.lastPerDay
      
      if (lastValue !== null && lastValue !== perDay && Math.abs(lastValue - perDay) > 0.01) {
                  // Animate from last value to new value
        const startValue = Math.floor(lastValue)
        const endValue = Math.floor(perDay)
        const duration = 1000 // 1 second
        const startTime = Date.now()
        
        const animate = () => {
          const elapsed = Date.now() - startTime
          const progress = Math.min(elapsed / duration, 1)
          
          // Ease out cubic
          const easeProgress = 1 - Math.pow(1 - progress, 3)
          const currentValue = Math.floor(startValue + (endValue - startValue) * easeProgress)
          
          setAnimatedValue(currentValue)
          
          if (progress < 1) {
            requestAnimationFrame(animate)
          } else {
            setAnimatedValue(null)
            setState(s => ({ ...s, lastPerDay: endValue }))
          }
        }
        
        animate()
      } else {
        setAnimatedValue(perDay)
        if (lastValue === null) {
          setState(s => ({ ...s, lastPerDay: perDay }))
        }
      }
    }
  }, [perDay])

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
    if (!isOnline) return
    if (!(state.useConversion && state.srcCurrency !== state.dstCurrency)) return
    
    if (state.lastRate && state.lastRate.from === state.srcCurrency && 
        state.lastRate.to === state.dstCurrency &&
        (Date.now() - state.lastRate.timestamp) < 60 * 60 * 1000) {
      return
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

  function handleBalanceChange(e) {
    const value = e.target.value
      .replace(/[^\d.]/g, '') // Only allow digits and decimal point
      .replace(/(\..*)\./g, '$1') // Only allow one decimal point
    onChange('balance', value)
  }

  function handleBalanceBlur(e) {
    const rawValue = e.target.value.replace(/,/g, '')
    const formatted = formatNumberWithCommas(rawValue)
    onChange('balance', formatted)
  }

  function handleBalanceFocus(e) {
    // Remove commas when focused
    const rawValue = e.target.value.replace(/,/g, '')
    onChange('balance', rawValue)
    // Select all content
    e.target.select()
  }

  function handleBalanceKeyDown(e) {
    if (e.key === 'Enter') {
      e.target.blur()
    }
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
  const displayValue = animatedValue !== null ? animatedValue : perDay

  return (
    <div className="app">
      <div className="app-header">
        <h1 className="app-title">DailySpend</h1>
        <div className="header-controls">
          {!isOnline && (
            <div className="offline-indicator">Offline</div>
          )}
          <button
            onClick={() => setSettingsOpen(true)}
            className="settings-btn"
            aria-label="Open settings"
          >
            <SettingsIcon />
          </button>
        </div>
      </div>

      <div className="main-content">
        
        {/* Result Display */}
        <div className="result-card">
          {error ? (
            <div className="error-message">{error}</div>
          ) : displayValue && daysLeft ? (
            <>
              <div className="amount-display">
                <div className="big-number">
                  {Number(displayValue).toLocaleString('en-GB', { 
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 2 
                  })}
                </div>
                <div className="currency-label">{displayCurrency}</div>
              </div>
              <div className="result-subtitle">Daily spending budget</div>
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
          <div className="glass-card half-width">
            <div className="inline-field">
              <label className="field-label-inline">Balance</label>
              <input
                type="text"
                inputMode="decimal"
                placeholder="0"
                value={state.balance}
                onChange={handleBalanceChange}
                onFocus={handleBalanceFocus}
                onBlur={handleBalanceBlur}
                onKeyDown={handleBalanceKeyDown}
                className="main-input-inline"
              />
              <button
                onClick={() => openCurrencyPicker('src')}
                className="currency-btn-inline"
                disabled={currenciesLoading}
              >
                {currenciesLoading ? '...' : state.srcCurrency}
              </button>
            </div>
          </div>

          <div className="glass-card half-width">
            <div className="inline-field">
              <label className="field-label-inline">Payday</label>
              <input
                type="date"
                pattern="\d{4}-\d{2}-\d{2}"
                placeholder="YYYY-MM-DD"
                required
                value={state.paydate}
                onChange={e => {
                  const value = e.target.value;
                  // Ensure value is in YYYY-MM-DD format
                  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
                    onChange('paydate', value);
                  }
                }}
                className="date-input-inline"
              />
            </div>
          </div>
        </div>

        {/* Currency Conversion Toggle */}
        <div className={`glass-card conversion-card ${state.useConversion ? 'active' : 'inactive'}`}>
          <div className="currency-toggle">
            <div className="toggle-left">
              <div className="toggle-content">
                <span className="toggle-text">Display in different currency</span>
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

        {/* PWA Install Button - Hidden when standalone */}
        {!isStandalone && (
          <div className="install-section">
            <button id="install-btn" hidden className="install-btn">
              Install App
            </button>
            <div className="install-hint">
              On iPhone: Share → "Add to Home Screen"
            </div>
          </div>
        )}
      </div>

      {/* Currency Picker Modal */}
      {currencyPickerOpen && (
        <div className="modal-overlay" onClick={() => setCurrencyPickerOpen(false)}>
          <div className="modal-panel picker" onClick={e => e.stopPropagation()}>
            <div className="modal-handle"></div>
            <h3 className="modal-title">Select Currency</h3>
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
            <h3 className="modal-title">Settings</h3>

            <div className="settings-field">
              <label className="settings-label">Exchange Rate Provider</label>
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
                <label className="settings-label">API Key</label>
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