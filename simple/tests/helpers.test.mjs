import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clean_isbn,
  is_valid_isbn,
  is_valid_isbn10,
  is_valid_isbn13,
  isbn13_to_10,
  isbn_lookup_forms,
  build_sru_url,
  parse_sru_response
} from '../helpers.js';

test('cleans ISBN input', () => {
  assert.equal(clean_isbn(' ISBN 978-0-306-40615-7 '), '9780306406157');
  assert.equal(clean_isbn('0-8044-2957-X'), '080442957X');
});

test('validates ISBN checksums', () => {
  assert.equal(is_valid_isbn13('9780306406157'), true);
  assert.equal(is_valid_isbn13('9780306406158'), false);
  assert.equal(is_valid_isbn13('1234567890128'), false);  // UPC, not Bookland
  assert.equal(is_valid_isbn10('0306406152'), true);
  assert.equal(is_valid_isbn10('0306406153'), false);
  assert.equal(is_valid_isbn('9791090636071'), true);
});

test('converts 978 ISBN-13 to ISBN-10', () => {
  assert.equal(isbn13_to_10('9780306406157'), '0306406152');
  assert.equal(isbn13_to_10('9791090636071'), null);  // 979 has no ISBN-10 form
  assert.deepEqual(isbn_lookup_forms('9780306406157'), ['9780306406157', '0306406152']);
});

test('builds direct and proxied SRU URLs', () => {
  const settings = { sru_base: 'https://alma.example/sru', proxy_base: '' };
  const direct = build_sru_url(settings, '9780306406157');
  assert.match(direct, /^https:\/\/alma\.example\/sru\?/);
  assert.match(direct, /operation=searchRetrieve/);
  assert.equal(new URL(direct).searchParams.get('query'), 'alma.isbn=9780306406157 or alma.isbn=0306406152');

  settings.proxy_base = 'https://proxy.example/?url=';
  assert.match(build_sru_url(settings, '9780306406157'), /^https:\/\/proxy\.example\/\?url=/);

  assert.equal(build_sru_url(settings, '123'), null);  // not an ISBN
});

test('parses a held SRU response', () => {
  const doc = fake_doc([
    element('numberOfRecords', {}, '1'),
    element('datafield', { tag: '245' }, '', [
      element('subfield', { code: 'a' }, 'The test book :'),
      element('subfield', { code: 'b' }, 'a subtitle /')
    ]),
    element('datafield', { tag: '264' }, '', [
      element('subfield', { code: 'c' }, '[2020]')
    ]),
    element('datafield', { tag: 'AVA' }, '', [
      element('subfield', { code: 'q' }, 'Main Library'),
      element('subfield', { code: 'c' }, 'Stacks'),
      element('subfield', { code: 'e' }, 'available'),
      element('subfield', { code: 'f' }, '1')
    ])
  ]);

  assert.deepEqual(parse_sru_response(doc), {
    count: 1,
    title: 'The test book : a subtitle',
    year: '2020',
    holdings: [{ lib: 'Main Library', loc: 'Stacks', avail: 'available', count: '1' }]
  });
});

test('reports SRU diagnostics and bad documents as errors', () => {
  const diagnostic = parse_sru_response(fake_doc([
    element('diagnostic', {}, '', [
      element('uri', {}, '200840'),
      element('message', {}, 'Unsupported combination of relation and index')
    ])
  ]));
  assert.equal(diagnostic.error, 'sru_diagnostic');
  assert.match(diagnostic.message, /Unsupported combination/);

  const empty = parse_sru_response(fake_doc([]));
  assert.equal(empty.error, 'malformed_xml');
});

// --- tiny fake XML document, just enough for parse_sru_response ------------

function fake_doc(children){
  return {
    children,
    getElementsByTagNameNS(_ns, name){
      return collect(this, name);
    }
  };
}

function element(name, attrs = {}, text = '', children = []){
  return {
    name,
    attrs,
    children,
    localName: name,
    getAttribute(attr){ return this.attrs[attr] || null; },
    get textContent(){
      return text || this.children.map(child => child.textContent).join('');
    }
  };
}

function collect(node, name){
  const found = [];
  for(const child of node.children || []){
    if(child.name === name) found.push(child);
    found.push(...collect(child, name));
  }
  return found;
}
