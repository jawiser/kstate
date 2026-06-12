import { cleanIsbn } from './isbn.js';
import { lookupCatalog } from './sru.js';
import { createLogger } from './logger.js';
import {
  addHistoryEntry,
  clearHistory,
  loadHistory,
  loadSettings,
  resetSettings,
  saveSettings,
  talliesFromHistory
} from './storage.js';
import { diagnosticsToJson, downloadText, historyToCsv } from './exports.js';
import { ScannerController } from './scanner.js';
import { AppUi, primoUrl } from './ui.js';

const logger = createLogger();
const ui = new AppUi(document);
let settings = loadSettings();
let history = loadHistory();
let currentIsbn = '';
let capabilities = {
  userAgent: navigator.userAgent,
  mediaDevices: Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
  barcodeDetector: 'BarcodeDetector' in window,
  barcodeFormats: [],
  quaggaLoaded: Boolean(window.Quagga)
};

ui.applySettings(settings);
renderHistory();
loadBarcodeFormats();

const scanner = new ScannerController({
  readerEl: document.getElementById('reader'),
  logger,
  onIsbn: isbn => lookup(isbn, 'camera'),
  onReadout: (message, holdMs) => {
    if(holdMs || ui.canUpdateReadout()) ui.setReadout(message, holdMs);
  },
  onSkip: message => ui.showScanNote(message),
  onState: isRunning => ui.setCameraRunning(isRunning)
});

document.getElementById('toggleCam').addEventListener('click', async () => {
  try{
    if(!scanner.scanning) ui.setCameraStarting();
    await scanner.toggle();
  }catch(error){
    ui.setCameraRunning(false);
    ui.showVerdict({
      kind: 'unknown',
      status: 'CAMERA UNAVAILABLE',
      isbn: '',
      title: '',
      meta: cameraMessage(error.category),
      holdings: [],
      errorCategory: error.category || 'camera_unavailable'
    });
  }
});

document.getElementById('manualGo').addEventListener('click', () => {
  lookup(document.getElementById('manualIsbn').value, 'manual');
});

document.getElementById('manualIsbn').addEventListener('keydown', event => {
  if(event.key === 'Enter') lookup(event.target.value, 'manual');
});

document.getElementById('openPrimo').addEventListener('click', () => {
  if(!currentIsbn) return;
  window.open(primoUrl(settings, currentIsbn), '_blank', 'noopener');
});

document.getElementById('scanNext').addEventListener('click', () => {
  ui.hideVerdict();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

for(const id of ['sruBase', 'proxyBase', 'primoVid']){
  document.getElementById(id).addEventListener('change', persistSettings);
}

document.getElementById('resetSettings').addEventListener('click', () => {
  settings = resetSettings();
  ui.applySettings(settings);
  logger.info('settings_reset');
});

document.getElementById('clearHistory').addEventListener('click', () => {
  if(!window.confirm('Clear saved scan history from this browser?')) return;
  history = clearHistory();
  renderHistory();
  logger.info('history_cleared');
});

document.getElementById('exportCsv').addEventListener('click', () => {
  downloadText(fileName('gift-triage-history', 'csv'), historyToCsv(history), 'text/csv');
  logger.info('history_exported', { format: 'csv', count: history.length });
});

document.getElementById('exportDiagnostics').addEventListener('click', () => {
  const json = diagnosticsToJson({
    settings,
    history,
    logs: logger.entries(),
    capabilities
  });
  downloadText(fileName('gift-triage-diagnostics', 'json'), json, 'application/json');
  logger.info('diagnostics_exported', { logCount: logger.entries().length });
});

async function lookup(rawIsbn, source){
  settings = saveSettings(ui.readSettings());
  const isbn = cleanIsbn(rawIsbn);
  currentIsbn = isbn;
  ui.hideVerdict();
  ui.setLoading(true);
  logger.info('lookup_started', { isbn, source });

  const result = await lookupCatalog(rawIsbn, {
    settings,
    fetchImpl: window.fetch.bind(window),
    parseXml: text => new DOMParser().parseFromString(text, 'application/xml'),
    logger
  });

  currentIsbn = result.isbn || isbn;
  ui.showVerdict(result);
  logger.info('lookup_finished', {
    isbn: currentIsbn,
    verdict: result.kind,
    errorCategory: result.errorCategory || null
  });

  if(result.isbn && result.errorCategory !== 'invalid_isbn'){
    history = addHistoryEntry(history, {
      id: makeId(),
      at: new Date().toISOString(),
      isbn: result.isbn,
      verdict: result.kind,
      title: result.title || '',
      label: result.title || result.isbn,
      source,
      errorCategory: result.errorCategory || ''
    });
    renderHistory();
  }
}

function persistSettings(){
  settings = saveSettings(ui.readSettings());
  logger.info('settings_saved', {
    proxyConfigured: Boolean(settings.proxyBase),
    primoVid: settings.primoVid
  });
}

function renderHistory(){
  ui.renderHistory(history, talliesFromHistory(history));
}

async function loadBarcodeFormats(){
  if(!capabilities.barcodeDetector || !window.BarcodeDetector.getSupportedFormats) return;
  try{
    capabilities = {
      ...capabilities,
      barcodeFormats: await window.BarcodeDetector.getSupportedFormats()
    };
  }catch(error){
    logger.info('barcode_formats_unavailable', { message: error.message });
  }
}

function cameraMessage(category){
  if(category === 'scanner_library_unavailable'){
    return 'The fallback barcode scanner library did not load. Type the ISBN below, or check the network connection and reload.';
  }
  return 'This browser blocked camera access or no compatible camera was available. Type the ISBN below, or open the hosted page directly in Safari or Chrome on your phone.';
}

function fileName(prefix, ext){
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return prefix + '-' + stamp + '.' + ext;
}

function makeId(){
  if(globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function'){
    return globalThis.crypto.randomUUID();
  }
  return String(Date.now()) + '-' + Math.random().toString(16).slice(2);
}
