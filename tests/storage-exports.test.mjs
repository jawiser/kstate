import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addHistoryEntry,
  clearHistory,
  DEFAULT_SETTINGS,
  loadHistory,
  loadSettings,
  resetSettings,
  saveSettings,
  talliesFromHistory
} from '../src/storage.js';
import { diagnosticsToJson, historyToCsv } from '../src/exports.js';

test('settings persist with defaults and reset cleanly', () => {
  const storage = new MemoryStorage();
  assert.equal(loadSettings(storage).sruBase, DEFAULT_SETTINGS.sruBase);

  saveSettings({ sruBase: ' https://alma ', proxyBase: ' https://proxy?url= ', primoVid: 'VID', primoBase: '' }, storage);
  assert.deepEqual(loadSettings(storage), {
    ...DEFAULT_SETTINGS,
    sruBase: 'https://alma',
    proxyBase: 'https://proxy?url=',
    primoVid: 'VID'
  });

  assert.deepEqual(resetSettings(storage), { ...DEFAULT_SETTINGS });
  assert.equal(loadSettings(storage).sruBase, DEFAULT_SETTINGS.sruBase);
});

test('history persists, tallies, and handles corrupt storage', () => {
  const storage = new MemoryStorage();
  let history = addHistoryEntry([], { isbn: '9780306406157', verdict: 'held' }, storage);
  history = addHistoryEntry(history, { isbn: '9781111111111', verdict: 'unknown' }, storage);

  assert.equal(loadHistory(storage).length, 2);
  assert.deepEqual(talliesFromHistory(loadHistory(storage)), { held: 1, notheld: 0, unknown: 1 });
  assert.deepEqual(clearHistory(storage), []);

  storage.setItem('gift-triage.history.v1', '{bad json');
  assert.deepEqual(loadHistory(storage), []);
});

test('exports history CSV and diagnostics JSON', () => {
  const history = [{
    at: '2026-06-10T12:00:00.000Z',
    isbn: '9780306406157',
    verdict: 'held',
    title: 'Comma, Title',
    source: 'manual',
    errorCategory: ''
  }];

  const csv = historyToCsv(history);
  assert.match(csv, /^timestamp,isbn,verdict,title,source,error_category/);
  assert.match(csv, /"Comma, Title"/);

  const diagnostics = JSON.parse(diagnosticsToJson({
    settings: { sruBase: 'sru', proxyBase: 'secret proxy', primoVid: 'vid' },
    history,
    logs: [{ level: 'info' }],
    capabilities: { barcodeDetector: true }
  }));
  assert.equal(diagnostics.settings.proxyConfigured, true);
  assert.equal(diagnostics.historyCount, 1);
  assert.equal(diagnostics.logs.length, 1);
});

class MemoryStorage{
  constructor(){
    this.map = new Map();
  }

  getItem(key){
    return this.map.has(key) ? this.map.get(key) : null;
  }

  setItem(key, value){
    this.map.set(key, String(value));
  }

  removeItem(key){
    this.map.delete(key);
  }
}
