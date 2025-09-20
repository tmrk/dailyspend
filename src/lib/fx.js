export async function listCurrencies() {
  try {
    const r = await fetch('https://api.frankfurter.dev/v1/currencies');
    if (!r.ok) throw new Error('Failed to fetch currencies');
    const json = await r.json();
    return Object.entries(json).sort(([a], [b]) => a.localeCompare(b));
  } catch(error) {
    console.error('Failed to fetch currencies from API:', error);
    throw error; // Don't use fallback - let the app handle caching
  }
}

export async function getRate(from, to, provider, apiKey) {
  if (from === to) return { value: 1, provider, timestamp: Date.now() };
  
  try {
    if (provider === 'frankfurter') {
      const url = `https://api.frankfurter.dev/v1/latest?base=${encodeURIComponent(from)}&symbols=${encodeURIComponent(to)}`;
      const r = await fetch(url, { 
        cache: 'no-store',
        headers: {
          'Accept': 'application/json',
        }
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
      const json = await r.json();
      if (!json.rates || json.rates[to] === undefined) {
        throw new Error(`Rate not found for ${from} to ${to}`);
      }
      return { 
        value: Number(json.rates[to]), 
        provider, 
        timestamp: Date.now(),
        date: json.date 
      };
    }
    
    if (provider === 'exchangerate-host') {
      if (!apiKey) throw new Error('API key required for exchangerate.host');
      const url = `https://api.exchangerate.host/latest?base=${encodeURIComponent(from)}&symbols=${encodeURIComponent(to)}&access_key=${encodeURIComponent(apiKey)}`;
      const r = await fetch(url, { 
        cache: 'no-store',
        headers: {
          'Accept': 'application/json',
        }
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
      const json = await r.json();
      
      if (json.error) {
        throw new Error(json.error.info || json.error.type || 'API Error');
      }
      
      const val = (json.rates && json.rates[to]) || json.result || json[to];
      if (val === undefined || val === null) {
        throw new Error(`Rate not found for ${from} to ${to}`);
      }
      return { 
        value: Number(val), 
        provider, 
        timestamp: Date.now(),
        date: json.date 
      };
    }
    
    throw new Error(`Unknown provider: ${provider}`);
  } catch (error) {
    console.error('Rate fetch failed:', error);
    throw error;
  }
}

export function formatMoney(value, code) {
  if (value === null || value === undefined || isNaN(value)) {
    return `0.00 ${code}`;
  }
  
  try {
    // Get user's locale for better formatting
    const locale = navigator.language || 'en-US';
    return new Intl.NumberFormat(locale, { 
      style: 'currency', 
      currency: code,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    }).format(value);
  } catch(error) {
    console.warn(`Currency formatting failed for ${code}:`, error);
    // More robust fallback
    const formatted = Number(value).toFixed(2);
    return `${formatted} ${code}`;
  }
}