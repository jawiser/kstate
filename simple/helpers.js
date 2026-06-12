// helpers.js - pure logic with no browser stuff in it, so it can be tested
// with node directly. Everything DOM/camera related lives in app.js.

// ---------------------------------------------------------------------------
// ISBN functions
// ---------------------------------------------------------------------------

// Strip everything except digits and X (X is a valid ISBN-10 check digit).
export function clean_isbn(raw){
  return String(raw || '').replace(/[^0-9Xx]/g, '').toUpperCase();
}

// ISBN-10 checksum: sum of digit * weight (10 down to 1) must divide by 11.
export function is_valid_isbn10(value){
  const isbn = clean_isbn(value);
  if(!/^\d{9}[\dX]$/.test(isbn)) return false;
  let total = 0;
  for(let i = 0; i < 10; i++){
    const digit = isbn[i] === 'X' ? 10 : Number(isbn[i]);
    total += (10 - i) * digit;
  }
  return total % 11 === 0;
}

// ISBN-13 checksum. Only 978/979 prefixes count as ISBNs - that is how we
// tell the real ISBN barcode apart from the UPC price barcode next to it.
export function is_valid_isbn13(value){
  const isbn = clean_isbn(value);
  if(!/^97[89]\d{10}$/.test(isbn)) return false;
  let total = 0;
  for(let i = 0; i < 12; i++){
    total += Number(isbn[i]) * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (total % 10)) % 10;
  return check === Number(isbn[12]);
}

export function is_valid_isbn(value){
  return is_valid_isbn13(value) || is_valid_isbn10(value);
}

// Convert a 978-xxx ISBN-13 to its old ISBN-10 form. 979 ISBNs have no
// ISBN-10 form so they return null. Old catalog records sometimes only
// have the ISBN-10, so we search for both.
export function isbn13_to_10(value){
  const isbn = clean_isbn(value);
  if(!/^978\d{10}$/.test(isbn) || !is_valid_isbn13(isbn)) return null;
  const core = isbn.slice(3, 12);
  let total = 0;
  for(let i = 0; i < 9; i++) total += (10 - i) * Number(core[i]);
  const check = (11 - (total % 11)) % 11;
  return core + (check === 10 ? 'X' : String(check));
}

// All the forms of this ISBN worth searching the catalog for.
export function isbn_lookup_forms(value){
  const isbn = clean_isbn(value);
  if(!is_valid_isbn(isbn)) return [];
  const forms = [isbn];
  const isbn10 = isbn.length === 13 ? isbn13_to_10(isbn) : null;
  if(isbn10) forms.push(isbn10);
  return forms;
}

// ---------------------------------------------------------------------------
// SRU (the catalog search API) functions
// ---------------------------------------------------------------------------

// Build the catalog search URL for an ISBN. If a proxy prefix is set the
// whole SRU URL gets URL-encoded and stuck on the end of it.
// Returns null if the value is not a valid ISBN.
export function build_sru_url(settings, raw_isbn){
  const forms = isbn_lookup_forms(raw_isbn);
  if(forms.length === 0) return null;
  const query = forms.map(f => 'alma.isbn=' + f).join(' or ');
  const params = new URLSearchParams({
    version: '1.2',
    operation: 'searchRetrieve',
    recordSchema: 'marcxml',
    maximumRecords: '5',
    query: query
  });
  const url = settings.sru_base.trim() + '?' + params.toString();
  if(settings.proxy_base.trim()){
    return settings.proxy_base.trim() + encodeURIComponent(url);
  }
  return url;
}

// Find all elements with a given tag name, ignoring XML namespaces.
// Works on real DOM documents and on the fake ones the tests use.
function get_all(doc, name){
  if(doc && typeof doc.getElementsByTagNameNS === 'function'){
    return Array.from(doc.getElementsByTagNameNS('*', name));
  }
  return [];
}

// Get a subfield value from a MARC datafield, e.g. sub(field, 'a').
function sub(datafield, code){
  for(const child of Array.from(datafield.children || [])){
    if(child.getAttribute && child.getAttribute('code') === code){
      return child.textContent.trim();
    }
  }
  return '';
}

// Parse the XML document the catalog sends back.
// Returns {error: '...'} on problems, otherwise:
//   {count, title, year, holdings: [{lib, loc, avail, count}]}
export function parse_sru_response(doc){
  if(get_all(doc, 'parsererror').length > 0){
    return { error: 'malformed_xml', message: 'The catalog returned malformed XML.' };
  }

  // SRU reports query problems inside the response body, not as HTTP errors.
  const diagnostics = get_all(doc, 'diagnostic');
  if(diagnostics.length > 0){
    let message = 'Alma returned an SRU diagnostic response.';
    for(const child of Array.from(diagnostics[0].children || [])){
      const child_name = child.localName || child.name || child.nodeName;
      if(child_name === 'message' && child.textContent.trim()) message = child.textContent.trim();
    }
    return { error: 'sru_diagnostic', message: message };
  }

  const number_el = get_all(doc, 'numberOfRecords')[0];
  if(!number_el){
    return { error: 'malformed_xml', message: 'The catalog response did not include a record count.' };
  }
  const count = Number.parseInt(number_el.textContent, 10);
  if(Number.isNaN(count)){
    return { error: 'malformed_xml', message: 'The catalog record count was not numeric.' };
  }

  // Pull the title (MARC field 245), year (264/260) and holdings (AVA)
  // out of the first record.
  let title = '';
  let year = '';
  const holdings = [];
  for(const field of get_all(doc, 'datafield')){
    const tag = field.getAttribute('tag');
    if(tag === '245' && !title){
      title = (sub(field, 'a') + ' ' + sub(field, 'b')).replace(/[/:;,]\s*$/, '').trim();
    }
    if((tag === '264' || tag === '260') && !year){
      const match = sub(field, 'c').match(/\d{4}/);
      if(match) year = match[0];
    }
    if(tag === 'AVA'){
      holdings.push({
        lib: sub(field, 'q') || sub(field, 'b'),
        loc: sub(field, 'c'),
        avail: sub(field, 'e') || sub(field, 't'),
        count: sub(field, 'f')
      });
    }
  }

  return { count: count, title: title, year: year, holdings: holdings };
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

// Quote a CSV cell if it contains a comma, quote or newline.
function csv_cell(value){
  const text = String(value === null || value === undefined ? '' : value);
  if(/[",\n\r]/.test(text)){
    return '"' + text.replaceAll('"', '""') + '"';
  }
  return text;
}

// Turn the scan history into CSV text with a header row.
export function history_to_csv(history){
  const lines = ['timestamp,isbn,verdict,title,source,error_category'];
  for(const entry of history){
    const row = [
      entry.at,
      entry.isbn,
      entry.verdict,
      entry.title || '',
      entry.source || '',
      entry.error_category || ''
    ];
    lines.push(row.map(csv_cell).join(','));
  }
  return lines.join('\n') + '\n';
}
