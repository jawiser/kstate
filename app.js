// app.js - all the browser-side code: history, catalog lookups, camera
// scanning and page updates. Pure logic (ISBN math, URL building, XML
// parsing) is imported from helpers.js so it can be unit tested.
//
// The code is organised top to bottom:
//   1. configuration + history (localStorage)
//   2. logging (console only)
//   3. catalog lookup
//   4. page updates
//   5. camera scanning
//   6. event wiring at the bottom

import {
  clean_isbn,
  is_valid_isbn,
  is_valid_isbn13,
  build_sru_url,
  parse_sru_response
} from './helpers.js';

// ---------------------------------------------------------------------------
// 1. Configuration and history
// ---------------------------------------------------------------------------

// Connection settings are fixed; edit here for a different institution.
const SETTINGS = {
  sru_base: 'https://k-state.alma.exlibrisgroup.com/view/sru/01KSU_INST',
  proxy_base: '',
  primo_vid: '01KSU_INST:NewUI',
  primo_base: 'https://k-state.primo.exlibrisgroup.com/discovery/search'
};

const HISTORY_KEY = 'gift-triage.history.simple.v1';
const MAX_HISTORY = 500;

function load_history(){
  try{
    const saved = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(saved) ? saved : [];
  }catch(err){
    return [];  // missing or corrupt - start fresh
  }
}

function save_history(){
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
}

// ---------------------------------------------------------------------------
// Global state
// ---------------------------------------------------------------------------

let history = load_history();
let current_isbn = '';   // the ISBN shown in the verdict, for "Open in Search It"

// ---------------------------------------------------------------------------
// 2. Logging
// ---------------------------------------------------------------------------

function log_event(level, event, details){
  console.log('[gift-triage]', level, event, details || '');
}

// ---------------------------------------------------------------------------
// 3. Catalog lookup
// ---------------------------------------------------------------------------

// Friendly messages per error category. Every one points at the
// "Open in Search It" button as the manual fallback.
const ERROR_MESSAGES = {
  timeout: 'The Alma lookup timed out. Tap "Open in Search It" for an instant answer, or try scanning again.',
  network_or_cors: 'Could not reach Alma directly from this browser, often because of a cross-origin block. Tap "Open in Search It" for an instant answer.',
  malformed_xml: 'Alma returned a response this tool could not read. Tap "Open in Search It" to verify manually.',
  sru_diagnostic: 'Alma rejected the catalog query. Tap "Open in Search It" to verify manually.'
};

// fetch() with a timeout, because fetch has no timeout option of its own.
async function fetch_with_timeout(url, timeout_ms){
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout_ms);
  try{
    return await fetch(url, { signal: controller.signal });
  }finally{
    clearTimeout(timer);
  }
}

// Look up an ISBN in the catalog. Always returns a verdict object:
//   {kind: 'held'|'notheld'|'unknown', status, isbn, title, meta,
//    holdings, error_category}
async function check_catalog(raw_isbn){
  const isbn = clean_isbn(raw_isbn);

  if(!is_valid_isbn(isbn)){
    return {
      kind: 'unknown', status: 'Not an ISBN', isbn: isbn, title: '',
      meta: 'That barcode does not look like a valid ISBN. Many books also carry a second UPC barcode; try the one that starts with 978 or 979.',
      holdings: [], error_category: 'invalid_isbn'
    };
  }

  const url = build_sru_url(SETTINGS, isbn);
  let error_category = '';
  let error_message = '';

  // Try twice - network blips and timeouts are common on phones.
  for(let attempt = 1; attempt <= 2; attempt++){
    let response = null;
    try{
      response = await fetch_with_timeout(url, 9000);
    }catch(err){
      error_category = err.name === 'AbortError' ? 'timeout' : 'network_or_cors';
      log_event('warn', 'lookup_failed', { isbn: isbn, attempt: attempt, category: error_category });
      continue;
    }

    if(!response.ok){
      error_category = 'http_status';
      error_message = 'Alma returned HTTP ' + response.status + '. Tap "Open in Search It" for an instant answer, or try again shortly.';
      log_event('warn', 'lookup_failed', { isbn: isbn, attempt: attempt, status: response.status });
      // Only retry on server errors / rate limiting.
      if(response.status >= 500 || response.status === 429) continue;
      break;
    }

    const xml_text = await response.text();
    const doc = new DOMParser().parseFromString(xml_text, 'application/xml');
    const parsed = parse_sru_response(doc);

    if(parsed.error){
      error_category = parsed.error;
      if(parsed.error === 'sru_diagnostic'){
        error_message = 'Alma rejected the catalog query: ' + parsed.message + '. Tap "Open in Search It" to verify manually.';
      }
      log_event('warn', 'lookup_failed', { isbn: isbn, attempt: attempt, category: parsed.error });
      break;
    }

    if(parsed.count > 0){
      let meta = parsed.count + (parsed.count === 1 ? ' catalog record matches' : ' catalog records match') + ' this ISBN.';
      if(parsed.year) meta = 'Published ' + parsed.year + '. ' + meta;
      return {
        kind: 'held', status: 'ALREADY HELD', isbn: isbn, title: parsed.title,
        meta: meta, holdings: parsed.holdings, error_category: ''
      };
    }

    return {
      kind: 'notheld', status: 'NOT IN CATALOG', isbn: isbn, title: '',
      meta: 'No record matches this ISBN. A different edition might still be held; tap below to double-check by title in Search It.',
      holdings: [], error_category: ''
    };
  }

  // Both attempts failed - tell the user to check manually.
  return {
    kind: 'unknown', status: 'CHECK MANUALLY', isbn: isbn, title: '',
    meta: error_message || ERROR_MESSAGES[error_category] || ERROR_MESSAGES.network_or_cors,
    holdings: [], error_category: error_category || 'unknown_lookup_error'
  };
}

// Run a lookup and update the page and history with the result.
async function do_lookup(raw_isbn, source){
  current_isbn = clean_isbn(raw_isbn);
  hide_verdict();
  el('spinner').classList.add('show');
  log_event('info', 'lookup_started', { isbn: current_isbn, source: source });

  const result = await check_catalog(raw_isbn);

  current_isbn = result.isbn || current_isbn;
  show_verdict(result);
  log_event('info', 'lookup_finished', { isbn: current_isbn, verdict: result.kind });

  // Record everything except invalid ISBNs.
  if(result.isbn && result.error_category !== 'invalid_isbn'){
    history.unshift({
      at: new Date().toISOString(),
      isbn: result.isbn,
      verdict: result.kind,
      title: result.title || '',
      source: source,
      error_category: result.error_category
    });
    history = history.slice(0, MAX_HISTORY);
    save_history();
    render_history();
  }
}

// ---------------------------------------------------------------------------
// 4. Page updates
// ---------------------------------------------------------------------------

// Shorthand - document.getElementById is a mouthful.
function el(id){
  return document.getElementById(id);
}

function show_verdict(result){
  el('spinner').classList.remove('show');
  el('verdict').className = 'verdict show ' + result.kind;
  el('vStatus').textContent = result.status;
  el('vIsbn').textContent = result.isbn ? 'ISBN ' + result.isbn : '';
  el('vTitle').textContent = result.title;
  el('vMeta').textContent = result.meta;
  el('vError').textContent = result.error_category ? 'Diagnostic: ' + result.error_category : '';
  el('vError').classList.toggle('show', Boolean(result.error_category));

  // Holdings list. Built with createElement so catalog text can't inject HTML.
  const list = el('vHoldings');
  list.innerHTML = '';
  for(const holding of result.holdings){
    const li = document.createElement('li');
    const lib = document.createElement('strong');
    lib.textContent = holding.lib || 'Holding';
    li.appendChild(lib);
    if(holding.loc) li.appendChild(document.createTextNode(' · ' + holding.loc));
    if(holding.count) li.appendChild(document.createTextNode(' · ' + holding.count + ' item(s)'));
    if(holding.avail){
      const avail = document.createElement('span');
      avail.className = holding.avail.toLowerCase().includes('available') ? 'avail' : 'unavail';
      avail.textContent = holding.avail;
      li.appendChild(document.createTextNode(' · '));
      li.appendChild(avail);
    }
    list.appendChild(li);
  }

  el('verdict').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function hide_verdict(){
  el('verdict').classList.remove('show');
}

function render_history(){
  // Tally counts per verdict.
  let held = 0, notheld = 0, unknown = 0;
  for(const entry of history){
    if(entry.verdict === 'held') held++;
    else if(entry.verdict === 'notheld') notheld++;
    else unknown++;
  }
  el('tHeld').textContent = held;
  el('tNew').textContent = notheld;
  el('tUnk').textContent = unknown;

  const tags = { held: 'HELD', notheld: 'NEW', unknown: '??' };
  const list = el('history');
  list.innerHTML = '';
  for(const entry of history){
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.className = 't';
    label.textContent = entry.title || entry.isbn;
    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = new Date(entry.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const tag = document.createElement('span');
    tag.className = 'tag ' + entry.verdict;
    tag.textContent = tags[entry.verdict] || '??';
    li.append(label, time, tag);
    list.appendChild(li);
  }
}

// Show a message in the live readout line under the camera.
// hold_ms keeps the message up; the "looking..." heartbeat respects it.
let readout_hold_until = 0;
function set_readout(message, hold_ms){
  el('liveRead').textContent = message;
  readout_hold_until = Date.now() + (hold_ms || 0);
}

let scan_note_timer = null;
function show_scan_note(message){
  el('scanNote').textContent = message;
  el('scanNote').style.opacity = '1';
  clearTimeout(scan_note_timer);
  scan_note_timer = setTimeout(() => { el('scanNote').style.opacity = '0'; }, 2500);
}

// ---------------------------------------------------------------------------
// 5. Camera scanning
//
// Two engines: the native BarcodeDetector API (Chrome/Android) and the
// Quagga library (everything else, mainly iPhones). Both feed accept_read().
// ---------------------------------------------------------------------------

let camera_stream = null;     // MediaStream when the native engine is running
let camera_video = null;      // <video> element for the native engine
let detector = null;          // BarcodeDetector instance
let raf_id = null;            // animation frame id for the native detect loop
let using_quagga = false;
let last_detect_at = 0;
let last_isbn = '';           // for ignoring repeat reads of the same book
let last_isbn_at = 0;
let quagga_candidate = '';    // Quagga reads are noisy: require the same
let quagga_hits = 0;          //   value twice in a row before accepting
let heartbeat_at = 0;
let heartbeat_dots = 0;
let audio_ctx = null;

function camera_running(){
  return Boolean(camera_stream || using_quagga || detector);
}

// Short feedback tone: high beep = accepted, low beep = skipped.
function beep(freq, ms, volume){
  try{
    if(!audio_ctx){
      // window['webkitAudioContext'] is the old Safari name for AudioContext.
      const AudioCtor = window.AudioContext || window['webkitAudioContext'];
      if(AudioCtor) audio_ctx = new AudioCtor();
    }
    if(!audio_ctx) return;
    if(audio_ctx.state === 'suspended') audio_ctx.resume();
    const osc = audio_ctx.createOscillator();
    const gain = audio_ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    gain.gain.value = volume;
    osc.connect(gain);
    gain.connect(audio_ctx.destination);
    osc.start();
    setTimeout(() => { try{ osc.stop(); }catch(err){} }, ms);
  }catch(err){
    // No sound is fine.
  }
}

// Ask the camera for continuous autofocus and a little zoom - both help a
// lot for close-up barcode reads. Ignored where unsupported.
async function tune_camera(track){
  try{
    if(!track || !track.getCapabilities) return;
    const caps = track.getCapabilities();
    const wanted = {};
    if(caps.focusMode && Array.from(caps.focusMode).includes('continuous')) wanted.focusMode = 'continuous';
    if(caps.zoom && caps.zoom.max) wanted.zoom = Math.min(2, caps.zoom.max);
    if(Object.keys(wanted).length > 0) await track.applyConstraints({ advanced: [wanted] });
  }catch(err){
    log_event('info', 'camera_tuning_skipped', { message: err.message });
  }
}

// The animated "Looking for a barcode..." line, so users know it is alive.
function heartbeat(){
  const now = Date.now();
  if(now - heartbeat_at < 600) return;
  heartbeat_at = now;
  heartbeat_dots = (heartbeat_dots + 1) % 4;
  if(Date.now() >= readout_hold_until){
    set_readout('Looking for a barcode' + '.'.repeat(heartbeat_dots + 1), 0);
  }
}

// A barcode was decoded. trusted=true for the native engine; Quagga reads
// must show up twice in a row before we believe them.
function accept_read(raw, trusted){
  const digits = clean_isbn(String(raw));
  if(!trusted){
    if(digits === quagga_candidate){
      quagga_hits++;
    }else{
      quagga_candidate = digits;
      quagga_hits = 1;
    }
    if(quagga_hits < 2){
      set_readout('Reading... ' + digits, 600);
      return;
    }
    quagga_candidate = '';
    quagga_hits = 0;
  }

  // The UPC price barcode is also EAN-13 but does not start 978/979.
  if(!is_valid_isbn13(digits)){
    beep(220, 90, 0.15);
    set_readout('Read ' + digits + ' - that is the price barcode. Slide to the 978/979 one.', 2200);
    show_scan_note('Skipped a price barcode - aim at the one starting 978 or 979');
    log_event('info', 'scanner_skipped_non_isbn', { raw: digits });
    return;
  }

  // Ignore re-reads of the same book for a few seconds.
  const now = Date.now();
  if(digits === last_isbn && now - last_isbn_at < 4000) return;
  last_isbn = digits;
  last_isbn_at = now;

  beep(1175, 140, 0.25);
  if(navigator.vibrate) navigator.vibrate(60);
  set_readout('Read ISBN ' + digits + ' - checking the catalog...', 3000);
  do_lookup(digits, 'camera');
}

// Native engine: getUserMedia + BarcodeDetector polled on animation frames.
// Returns false if the browser does not support it (then we try Quagga).
async function start_native_camera(){
  if(!('BarcodeDetector' in window)) return false;
  let formats = [];
  try{
    formats = await window.BarcodeDetector.getSupportedFormats();
  }catch(err){
    return false;
  }
  if(!formats.includes('ean_13')) return false;

  detector = new window.BarcodeDetector({ formats: ['ean_13'] });
  camera_stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
    audio: false
  });
  camera_video = document.createElement('video');
  camera_video.setAttribute('playsinline', 'true');
  camera_video.muted = true;
  camera_video.style.width = '100%';
  camera_video.style.borderRadius = '8px';
  el('reader').innerHTML = '';
  el('reader').appendChild(camera_video);
  camera_video.srcObject = camera_stream;
  await camera_video.play();
  await tune_camera(camera_stream.getVideoTracks()[0]);
  detect_loop();
  return true;
}

function detect_loop(){
  if(!detector || !camera_video) return;
  raf_id = requestAnimationFrame(detect_loop);
  const now = Date.now();
  if(now - last_detect_at < 90) return;  // ~11 checks/sec is plenty
  last_detect_at = now;
  detector.detect(camera_video)
    .then(codes => {
      if(codes.length > 0) accept_read(codes[0].rawValue, true);
      else heartbeat();
    })
    .catch(() => heartbeat());
}

// Fallback engine: Quagga renders its own video inside #reader.
async function start_quagga_camera(){
  if(!window.Quagga){
    const err = new Error('The fallback barcode scanner library did not load. Type the ISBN below, or check the network connection and reload.');
    err.category = 'scanner_library_unavailable';
    throw err;
  }
  using_quagga = true;
  el('reader').innerHTML = '';
  await new Promise((resolve, reject) => {
    window.Quagga.init({
      inputStream: {
        name: 'Live',
        type: 'LiveStream',
        target: el('reader'),
        constraints: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
      },
      locator: { patchSize: 'medium', halfSample: true },
      numOfWorkers: 0,
      frequency: 10,
      decoder: { readers: ['ean_reader'] },
      locate: true
    }, err => err ? reject(err) : resolve());
  });
  window.Quagga.start();

  const video = el('reader').querySelector('video');
  if(video){
    video.setAttribute('playsinline', 'true');
    video.muted = true;
    video.style.width = '100%';
    video.style.borderRadius = '8px';
    if(video.srcObject && video.srcObject.getVideoTracks){
      await tune_camera(video.srcObject.getVideoTracks()[0]);
    }
  }

  window.Quagga.onProcessed(heartbeat);
  window.Quagga.onDetected(result => {
    const code = result && result.codeResult ? result.codeResult.code : '';
    if(code) accept_read(code, false);
  });
}

async function start_camera(){
  el('toggleCam').disabled = true;
  el('toggleCam').textContent = 'Starting...';
  try{
    const native_ok = await start_native_camera();
    if(!native_ok) await start_quagga_camera();
    el('toggleCam').textContent = 'Stop camera';
    set_readout('Camera on (' + (native_ok ? 'native' : 'Quagga') + ' engine). Hold the barcode 5-10 inches away.', 3000);
    log_event('info', 'scanner_started', { engine: native_ok ? 'native' : 'quagga' });
  }catch(err){
    stop_camera();
    log_event('warn', 'scanner_failed', { category: err.category || 'camera_unavailable', message: err.message });
    show_verdict({
      kind: 'unknown', status: 'CAMERA UNAVAILABLE', isbn: '', title: '',
      meta: err.category === 'scanner_library_unavailable'
        ? err.message
        : 'This browser blocked camera access or no compatible camera was available. Type the ISBN below, or open the hosted page directly in Safari or Chrome on your phone.',
      holdings: [], error_category: err.category || 'camera_unavailable'
    });
  }finally{
    el('toggleCam').disabled = false;
  }
}

function stop_camera(){
  if(raf_id){
    cancelAnimationFrame(raf_id);
    raf_id = null;
  }
  detector = null;
  if(using_quagga && window.Quagga){
    try{ window.Quagga.stop(); }catch(err){}
    using_quagga = false;
  }
  if(camera_stream){
    for(const track of camera_stream.getTracks()) track.stop();
    camera_stream = null;
  }
  camera_video = null;
  quagga_candidate = '';
  quagga_hits = 0;
  el('reader').innerHTML = '';
  el('toggleCam').textContent = 'Start camera';
  set_readout('', 0);
}

// ---------------------------------------------------------------------------
// 6. Event wiring
// ---------------------------------------------------------------------------

render_history();

el('toggleCam').addEventListener('click', () => {
  if(camera_running()) stop_camera();
  else start_camera();
});

el('manualGo').addEventListener('click', () => {
  do_lookup(el('manualIsbn').value, 'manual');
});

el('manualIsbn').addEventListener('keydown', event => {
  if(event.key === 'Enter') do_lookup(el('manualIsbn').value, 'manual');
});

el('openPrimo').addEventListener('click', () => {
  if(!current_isbn) return;
  const url = SETTINGS.primo_base +
    '?query=any,contains,' + encodeURIComponent(current_isbn) +
    '&vid=' + encodeURIComponent(SETTINGS.primo_vid);
  window.open(url, '_blank', 'noopener');
});

el('scanNext').addEventListener('click', () => {
  hide_verdict();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

el('clearHistory').addEventListener('click', () => {
  if(!window.confirm('Clear saved scan history from this browser?')) return;
  history = [];
  localStorage.removeItem(HISTORY_KEY);
  render_history();
  log_event('info', 'history_cleared');
});
