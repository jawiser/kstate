import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSruUrl, lookupCatalog, LookupError, parseSruDocument } from '../src/sru.js';

test('builds direct and proxied SRU URLs', () => {
  const direct = buildSruUrl({ sruBase: 'https://alma.example/sru', proxyBase: '' }, '9780306406157');
  assert.match(direct, /^https:\/\/alma\.example\/sru\?/);
  assert.match(direct, /operation=searchRetrieve/);
  assert.equal(new URL(direct).searchParams.get('query'), 'alma.isbn=9780306406157 or alma.isbn=0306406152');

  const proxied = buildSruUrl({ sruBase: 'https://alma.example/sru', proxyBase: 'https://proxy.example/?url=' }, '9780306406157');
  assert.match(proxied, /^https:\/\/proxy\.example\/\?url=/);
});

test('maps SRU diagnostics to a catalog diagnostic error', () => {
  const doc = fakeDoc([
    el('diagnostic', {}, '', [
      el('uri', {}, '200840'),
      el('message', {}, 'Unsupported combination of relation and index')
    ])
  ]);

  assert.throws(
    () => parseSruDocument(doc),
    error => error instanceof LookupError &&
      error.category === 'sru_diagnostic' &&
      error.message === 'Unsupported combination of relation and index' &&
      error.status === '200840'
  );
});

test('rejects invalid ISBN URL generation', () => {
  assert.throws(() => buildSruUrl({ sruBase: 'x', proxyBase: '' }, '123'), LookupError);
});

test('parses held SRU response document', () => {
  const doc = fakeDoc([
    el('numberOfRecords', {}, '1'),
    el('datafield', { tag: '245' }, '', [
      el('subfield', { code: 'a' }, 'The test book :'),
      el('subfield', { code: 'b' }, 'a subtitle /')
    ]),
    el('datafield', { tag: '264' }, '', [
      el('subfield', { code: 'c' }, '[2020]')
    ]),
    el('datafield', { tag: 'AVA' }, '', [
      el('subfield', { code: 'q' }, 'Main Library'),
      el('subfield', { code: 'c' }, 'Stacks'),
      el('subfield', { code: 'e' }, 'available'),
      el('subfield', { code: 'f' }, '1')
    ])
  ]);

  assert.deepEqual(parseSruDocument(doc), {
    count: 1,
    title: 'The test book : a subtitle',
    year: '2020',
    holdings: [{ lib: 'Main Library', loc: 'Stacks', avail: 'available', count: '1' }]
  });
});

test('lookupCatalog maps not-held and network errors to result objects', async () => {
  const notHeld = await lookupCatalog('9780306406157', {
    settings: { sruBase: 'https://alma.example/sru', proxyBase: '' },
    fetchImpl: async () => ({ ok: true, text: async () => '<xml />' }),
    parseXml: () => fakeDoc([el('numberOfRecords', {}, '0')]),
    retries: 0
  });
  assert.equal(notHeld.kind, 'notheld');

  const failed = await lookupCatalog('9780306406157', {
    settings: { sruBase: 'https://alma.example/sru', proxyBase: '' },
    fetchImpl: async () => { throw new TypeError('blocked'); },
    retries: 0
  });
  assert.equal(failed.kind, 'unknown');
  assert.equal(failed.errorCategory, 'network_or_cors');
});

function fakeDoc(children){
  return {
    children,
    getElementsByTagNameNS(_ns, localName){
      return collect(this, localName);
    }
  };
}

function el(name, attrs = {}, text = '', children = []){
  return {
    name,
    attrs,
    children,
    getAttribute(attr){ return this.attrs[attr] || null; },
    get textContent(){
      return text || this.children.map(child => child.textContent).join('');
    }
  };
}

function collect(node, localName){
  const found = [];
  for(const child of node.children || []){
    if(child.name === localName) found.push(child);
    found.push(...collect(child, localName));
  }
  return found;
}
