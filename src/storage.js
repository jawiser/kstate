export const DEFAULT_SETTINGS = Object.freeze({
  sruBase: 'https://k-state.alma.exlibrisgroup.com/view/sru/01KSU_INST',
  proxyBase: '',
  primoVid: '01KSU_INST:NewUI',
  primoBase: 'https://k-state.primo.exlibrisgroup.com/discovery/search'
});

const SETTINGS_KEY = 'gift-triage.settings.v1';
const HISTORY_KEY = 'gift-triage.history.v1';
const MAX_HISTORY = 500;

function readJson(storage, key, fallback){
  try{
    const raw = storage.getItem(key);
    if(!raw) return fallback;
    return JSON.parse(raw);
  }catch(_err){
    return fallback;
  }
}

function writeJson(storage, key, value){
  storage.setItem(key, JSON.stringify(value));
}

export function loadSettings(storage = window.localStorage){
  const saved = readJson(storage, SETTINGS_KEY, {});
  return { ...DEFAULT_SETTINGS, ...(saved && typeof saved === 'object' ? saved : {}) };
}

export function saveSettings(settings, storage = window.localStorage){
  const next = {
    sruBase: String(settings.sruBase || '').trim() || DEFAULT_SETTINGS.sruBase,
    proxyBase: String(settings.proxyBase || '').trim(),
    primoVid: String(settings.primoVid || '').trim() || DEFAULT_SETTINGS.primoVid,
    primoBase: String(settings.primoBase || '').trim() || DEFAULT_SETTINGS.primoBase
  };
  writeJson(storage, SETTINGS_KEY, next);
  return next;
}

export function resetSettings(storage = window.localStorage){
  storage.removeItem(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS };
}

export function loadHistory(storage = window.localStorage){
  const history = readJson(storage, HISTORY_KEY, []);
  if(!Array.isArray(history)) return [];
  return history.filter(entry => entry && typeof entry === 'object');
}

export function saveHistory(history, storage = window.localStorage){
  const trimmed = Array.isArray(history) ? history.slice(0, MAX_HISTORY) : [];
  writeJson(storage, HISTORY_KEY, trimmed);
  return trimmed;
}

export function addHistoryEntry(history, entry, storage = window.localStorage){
  const next = [entry, ...(Array.isArray(history) ? history : [])].slice(0, MAX_HISTORY);
  saveHistory(next, storage);
  return next;
}

export function clearHistory(storage = window.localStorage){
  storage.removeItem(HISTORY_KEY);
  return [];
}

export function talliesFromHistory(history){
  return (Array.isArray(history) ? history : []).reduce((totals, entry) => {
    if(entry.verdict === 'held') totals.held += 1;
    else if(entry.verdict === 'notheld') totals.notheld += 1;
    else if(entry.verdict === 'unknown') totals.unknown += 1;
    return totals;
  }, { held: 0, notheld: 0, unknown: 0 });
}
