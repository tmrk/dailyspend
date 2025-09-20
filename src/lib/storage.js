const KEY = 'dailyspend:v2'; // Updated version for new features

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    
    const parsed = JSON.parse(raw);
    
    // Migration logic for older versions
    if (parsed.version !== 'v2') {
      // If it's an older version, preserve the data but update structure
      const migrated = {
        ...parsed,
        version: 'v2',
        cachedCurrencies: parsed.cachedCurrencies || null,
        useConversion: parsed.useConversion || false
      };
      saveState(migrated);
      return migrated;
    }
    
    return parsed;
  } catch (error) { 
    console.warn('Failed to load state from localStorage:', error);
    return {}; 
  }
}

export function saveState(obj) {
  try {
    const dataToSave = {
      ...obj,
      version: 'v2',
      lastSaved: Date.now()
    };
    localStorage.setItem(KEY, JSON.stringify(dataToSave));
  } catch (error) {
    console.warn('Storage failed:', error);
    // Try to clear some space if quota exceeded
    if (error.name === 'QuotaExceededError') {
      try {
        // Clear old cache entries but keep essential data
        const essential = {
          balance: obj.balance,
          srcCurrency: obj.srcCurrency,
          dstCurrency: obj.dstCurrency,
          paydate: obj.paydate,
          useConversion: obj.useConversion,
          provider: obj.provider,
          apiKey: obj.apiKey,
          version: 'v2'
        };
        localStorage.setItem(KEY, JSON.stringify(essential));
      } catch (retryError) {
        console.error('Failed to save even essential data:', retryError);
      }
    }
  }
}

export function clearState() {
  try {
    localStorage.removeItem(KEY);
    return true;
  } catch (error) {
    console.warn('Failed to clear state:', error);
    return false;
  }
}