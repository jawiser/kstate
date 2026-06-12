import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanIsbn,
  isbn13to10,
  isBooklandIsbn13,
  isValidIsbn10,
  isValidIsbn13,
  lookupForms,
  validIsbn
} from '../src/isbn.js';

test('cleans ISBN input', () => {
  assert.equal(cleanIsbn(' ISBN 978-0-306-40615-7 '), '9780306406157');
  assert.equal(cleanIsbn('0-8044-2957-X'), '080442957X');
});

test('validates ISBN checksums', () => {
  assert.equal(isValidIsbn13('9780306406157'), true);
  assert.equal(isValidIsbn13('9780306406158'), false);
  assert.equal(isValidIsbn10('0306406152'), true);
  assert.equal(isValidIsbn10('0306406153'), false);
  assert.equal(validIsbn('9791090636071'), true);
});

test('detects Bookland ISBN-13 values', () => {
  assert.equal(isBooklandIsbn13('9780306406157'), true);
  assert.equal(isBooklandIsbn13('9780306406158'), false);
  assert.equal(isBooklandIsbn13('1234567890128'), false);
});

test('converts 978 ISBN-13 to ISBN-10 lookup form', () => {
  assert.equal(isbn13to10('9780306406157'), '0306406152');
  assert.equal(isbn13to10('9791090636071'), null);
  assert.deepEqual(lookupForms('9780306406157'), ['9780306406157', '0306406152']);
});
