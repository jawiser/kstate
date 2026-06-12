import { cleanIsbn, lookupForms, validIsbn } from './isbn.js';

export class LookupError extends Error{
  constructor(category, message, { retryable = false, status = null } = {}){
    super(message);
    this.name = 'LookupError';
    this.category = category;
    this.retryable = retryable;
    this.status = status;
  }
}

export function buildSruUrl(settings, rawIsbn, maximumRecords = 5){
  const forms = lookupForms(rawIsbn);
  if(!forms.length) throw new LookupError('invalid_isbn', 'The value is not a valid ISBN.');
  const cql = forms.map(form => 'alma.isbn=' + form).join(' or ');
  const base = String(settings.sruBase || '').trim();
  const proxy = String(settings.proxyBase || '').trim();
  const params = new URLSearchParams({
    version: '1.2',
    operation: 'searchRetrieve',
    recordSchema: 'marcxml',
    maximumRecords: String(maximumRecords),
    query: cql
  });
  const sruUrl = base + '?' + params.toString();
  return proxy ? proxy + encodeURIComponent(sruUrl) : sruUrl;
}

export function parseSruDocument(doc){
  const parserErrors = getElements(doc, 'parsererror');
  if(parserErrors.length) throw new LookupError('malformed_xml', 'The catalog returned malformed XML.');

  const diagnostic = firstSruDiagnostic(doc);
  if(diagnostic){
    throw new LookupError(
      'sru_diagnostic',
      diagnostic.message || 'Alma returned an SRU diagnostic response.',
      { status: diagnostic.uri }
    );
  }

  const numberEl = getElements(doc, 'numberOfRecords')[0];
  if(!numberEl) throw new LookupError('malformed_xml', 'The catalog response did not include a record count.');

  const count = Number.parseInt(numberEl.textContent, 10);
  if(Number.isNaN(count)) throw new LookupError('malformed_xml', 'The catalog record count was not numeric.');

  const first = parseFirstRecord(doc);
  return { count, ...first };
}

export function parseSruXml(xmlText, parseXml){
  const parser = parseXml || ((text) => new DOMParser().parseFromString(text, 'application/xml'));
  return parseSruDocument(parser(xmlText));
}

export async function lookupCatalog(rawIsbn, {
  settings,
  fetchImpl = fetch,
  parseXml,
  timeoutMs = 9000,
  retries = 1,
  logger = null
}){
  const isbn = cleanIsbn(rawIsbn);
  if(!validIsbn(isbn)){
    return {
      kind: 'unknown',
      status: 'Not an ISBN',
      isbn,
      title: '',
      meta: 'That barcode does not look like a valid ISBN. Many books also carry a second UPC barcode; try the one that starts with 978 or 979.',
      holdings: [],
      errorCategory: 'invalid_isbn'
    };
  }

  let lastError = null;
  for(let attempt = 0; attempt <= retries; attempt++){
    try{
      const url = buildSruUrl(settings, isbn);
      const response = await fetchWithTimeout(fetchImpl, url, timeoutMs);
      if(!response.ok){
        throw new LookupError('http_status', 'Catalog returned HTTP ' + response.status + '.', {
          retryable: response.status >= 500 || response.status === 429,
          status: response.status
        });
      }
      const xmlText = await response.text();
      const parsed = parseSruXml(xmlText, parseXml);

      if(parsed.count > 0){
        const meta = (parsed.year ? 'Published ' + parsed.year + '. ' : '') +
          parsed.count + (parsed.count === 1 ? ' catalog record matches' : ' catalog records match') +
          ' this ISBN.';
        return {
          kind: 'held',
          status: 'ALREADY HELD',
          isbn,
          title: parsed.title || '',
          meta,
          holdings: parsed.holdings,
          count: parsed.count
        };
      }

      return {
        kind: 'notheld',
        status: 'NOT IN CATALOG',
        isbn,
        title: '',
        meta: 'No record matches this ISBN. A different edition might still be held; tap below to double-check by title in Search It.',
        holdings: [],
        count: 0
      };
    }catch(error){
      lastError = normalizeLookupError(error);
      if(logger) logger.warn('lookup_failed', { isbn, attempt: attempt + 1, category: lastError.category, message: lastError.message });
      if(!(lastError.retryable && attempt < retries)) break;
    }
  }

  return {
    kind: 'unknown',
    status: 'CHECK MANUALLY',
    isbn,
    title: '',
    meta: messageForError(lastError),
    holdings: [],
    errorCategory: lastError ? lastError.category : 'unknown_lookup_error'
  };
}

async function fetchWithTimeout(fetchImpl, url, timeoutMs){
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try{
    return await fetchImpl(url, { signal: ctrl.signal });
  }catch(error){
    if(error && error.name === 'AbortError'){
      throw new LookupError('timeout', 'Catalog lookup timed out.', { retryable: true });
    }
    throw new LookupError('network_or_cors', 'Catalog lookup was blocked or failed.', { retryable: true });
  }finally{
    clearTimeout(timer);
  }
}

function normalizeLookupError(error){
  if(error instanceof LookupError) return error;
  return new LookupError('unknown_lookup_error', error && error.message ? error.message : 'Lookup failed.');
}

function messageForError(error){
  if(!error){
    return 'Could not reach Alma directly from this browser. Tap "Open in Search It" for an instant answer, or check Connection settings.';
  }
  if(error.category === 'timeout'){
    return 'The Alma lookup timed out. Tap "Open in Search It" for an instant answer, or try scanning again.';
  }
  if(error.category === 'http_status'){
    return 'Alma returned HTTP ' + error.status + '. Tap "Open in Search It" for an instant answer, or try again shortly.';
  }
  if(error.category === 'malformed_xml'){
    return 'Alma returned a response this tool could not read. Tap "Open in Search It" to verify manually.';
  }
  if(error.category === 'sru_diagnostic'){
    return 'Alma rejected the catalog query: ' + error.message + '. Tap "Open in Search It" to verify manually.';
  }
  return 'Could not reach Alma directly from this browser, often because of a cross-origin block. Tap "Open in Search It" for an instant answer, or add a proxy prefix in Connection settings.';
}

function firstSruDiagnostic(doc){
  const diagnostics = getElements(doc, 'diagnostic');
  if(!diagnostics.length) return null;
  const diagnostic = diagnostics[0];
  const uri = firstChildText(diagnostic, 'uri');
  const message = firstChildText(diagnostic, 'message');
  return { uri, message };
}

function parseFirstRecord(doc){
  let title = '';
  let year = '';
  const holdings = [];
  const datafields = getElements(doc, 'datafield');

  for(const df of datafields){
    const tag = df.getAttribute('tag');
    const sub = code => {
      for(const sf of Array.from(df.children || [])){
        if(sf.getAttribute && sf.getAttribute('code') === code) return sf.textContent.trim();
      }
      return '';
    };

    if(tag === '245' && !title){
      title = (sub('a') + ' ' + sub('b')).replace(/[/:;,]\s*$/, '').trim();
    }
    if((tag === '264' || tag === '260') && !year){
      const match = (sub('c') || '').match(/\d{4}/);
      if(match) year = match[0];
    }
    if(tag === 'AVA'){
      holdings.push({
        lib: sub('q') || sub('b'),
        loc: sub('c'),
        avail: sub('e') || sub('t'),
        count: sub('f')
      });
    }
  }

  return { title, year, holdings };
}

function getElements(doc, localName){
  if(doc && typeof doc.getElementsByTagNameNS === 'function'){
    return Array.from(doc.getElementsByTagNameNS('*', localName));
  }
  if(doc && typeof doc.getElementsByTagName === 'function'){
    return Array.from(doc.getElementsByTagName(localName));
  }
  return [];
}

function firstChildText(node, localName){
  for(const child of Array.from(node.children || [])){
    const childName = child.localName || child.name || child.nodeName;
    if(childName === localName) return child.textContent.trim();
  }
  return '';
}
