import { DEFAULT_SETTINGS } from './storage.js';

const $ = (doc, id) => doc.getElementById(id);

export class AppUi{
  constructor(doc){
    this.doc = doc;
    this.verdict = $(doc, 'verdict');
    this.spinner = $(doc, 'spinner');
    this.liveRead = $(doc, 'liveRead');
    this.scanNote = $(doc, 'scanNote');
    this.refs = {
      status: $(doc, 'vStatus'),
      isbn: $(doc, 'vIsbn'),
      title: $(doc, 'vTitle'),
      meta: $(doc, 'vMeta'),
      error: $(doc, 'vError'),
      holdings: $(doc, 'vHoldings'),
      history: $(doc, 'history'),
      held: $(doc, 'tHeld'),
      notheld: $(doc, 'tNew'),
      unknown: $(doc, 'tUnk'),
      toggleCam: $(doc, 'toggleCam'),
      sruBase: $(doc, 'sruBase'),
      proxyBase: $(doc, 'proxyBase'),
      primoVid: $(doc, 'primoVid')
    };
    this.skipTimer = null;
  }

  applySettings(settings){
    this.refs.sruBase.value = settings.sruBase || DEFAULT_SETTINGS.sruBase;
    this.refs.proxyBase.value = settings.proxyBase || '';
    this.refs.primoVid.value = settings.primoVid || DEFAULT_SETTINGS.primoVid;
  }

  readSettings(){
    return {
      sruBase: this.refs.sruBase.value.trim(),
      proxyBase: this.refs.proxyBase.value.trim(),
      primoVid: this.refs.primoVid.value.trim(),
      primoBase: DEFAULT_SETTINGS.primoBase
    };
  }

  setLoading(isLoading){
    this.spinner.classList.toggle('show', Boolean(isLoading));
  }

  showVerdict(result){
    this.setLoading(false);
    this.verdict.className = 'verdict show ' + result.kind;
    this.refs.status.textContent = result.status || '';
    this.refs.isbn.textContent = result.isbn ? 'ISBN ' + result.isbn : '';
    this.refs.title.textContent = result.title || '';
    this.refs.meta.textContent = result.meta || '';
    this.refs.error.textContent = result.errorCategory ? 'Diagnostic: ' + result.errorCategory : '';
    this.refs.error.classList.toggle('show', Boolean(result.errorCategory));
    this.renderHoldings(result.holdings || []);
    this.verdict.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  hideVerdict(){
    this.verdict.classList.remove('show');
  }

  renderHoldings(holdings){
    this.refs.holdings.innerHTML = '';
    for(const holding of holdings){
      const li = this.doc.createElement('li');
      const strong = this.doc.createElement('strong');
      strong.textContent = holding.lib || 'Holding';
      li.appendChild(strong);
      appendText(li, holding.loc);
      appendText(li, holding.count ? holding.count + ' item(s)' : '');
      if(holding.avail){
        const span = this.doc.createElement('span');
        span.className = String(holding.avail).toLowerCase().includes('available') ? 'avail' : 'unavail';
        span.textContent = holding.avail;
        li.appendChild(this.doc.createTextNode(' · '));
        li.appendChild(span);
      }
      this.refs.holdings.appendChild(li);
    }
  }

  renderHistory(history, tallies){
    this.refs.held.textContent = tallies.held;
    this.refs.notheld.textContent = tallies.notheld;
    this.refs.unknown.textContent = tallies.unknown;
    this.refs.history.innerHTML = '';

    for(const entry of history){
      const li = this.doc.createElement('li');
      const label = this.doc.createElement('span');
      label.className = 't';
      label.textContent = entry.title || entry.label || entry.isbn || '';
      const time = this.doc.createElement('span');
      time.className = 'time';
      time.textContent = formatTime(entry.at);
      const tag = this.doc.createElement('span');
      tag.className = 'tag ' + entry.verdict;
      tag.textContent = tagText(entry.verdict);
      li.append(label, time, tag);
      this.refs.history.appendChild(li);
    }
  }

  setCameraStarting(){
    this.refs.toggleCam.disabled = true;
    this.refs.toggleCam.textContent = 'Starting...';
  }

  setCameraRunning(isRunning){
    this.refs.toggleCam.disabled = false;
    this.refs.toggleCam.textContent = isRunning ? 'Stop camera' : 'Start camera';
  }

  setReadout(message, holdMs = 0){
    this.liveRead.textContent = message;
    this.readoutHoldUntil = Date.now() + holdMs;
  }

  canUpdateReadout(){
    return Date.now() >= (this.readoutHoldUntil || 0);
  }

  showScanNote(message){
    this.scanNote.textContent = message;
    this.scanNote.style.opacity = '1';
    clearTimeout(this.skipTimer);
    this.skipTimer = setTimeout(() => {
      this.scanNote.style.opacity = '0';
    }, 2500);
  }
}

export function primoUrl(settings, isbn){
  return settings.primoBase + '?query=any,contains,' + encodeURIComponent(isbn) +
    '&vid=' + encodeURIComponent(settings.primoVid);
}

function appendText(parent, value){
  if(!value) return;
  parent.appendChild(parent.ownerDocument.createTextNode(' · ' + value));
}

function tagText(verdict){
  if(verdict === 'held') return 'HELD';
  if(verdict === 'notheld') return 'NEW';
  return '??';
}

function formatTime(value){
  if(!value) return '';
  const date = new Date(value);
  if(Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
