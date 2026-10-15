/**
 * Gift Triage Scanner → Google Sheet
 *
 * Paste this into the sheet's Extensions → Apps Script editor, then
 * Deploy → New deployment → Web app (Execute as: Me; Who has access: Anyone).
 * Copy the web app link (ends in /exec) into the scanner's Connection settings.
 */

const SHEET_NAME = 'Gift scans';
const HEADERS = [
  'Saved at', 'ISBN', 'Title', 'Author(s)', 'Publisher', 'Year',
  'Catalog result', 'List price', 'Currency', 'Price source',
  'Batch / donor', 'Note', 'Row ID'
];
const ID_COL = HEADERS.length;   // Row ID is the last column

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) sh = ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) {
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sh.getRange('B:B').setNumberFormat('@');          // keep ISBNs as text
    sh.getRange('H:H').setNumberFormat('0.00');
    sh.getRange('A:A').setNumberFormat('yyyy-mm-dd h:mm');
  }
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// Used by the scanner's "Test connection" button.
function doGet() {
  const sh = getSheet_();
  return json_({ ok: true, sheet: SHEET_NAME, rows: Math.max(0, sh.getLastRow() - 1) });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const data = JSON.parse(e.postData.contents);
    const rows = Array.isArray(data.rows) ? data.rows : [data];
    const sh = getSheet_();

    // Skip rows already saved (a retry after a dropped connection resends them).
    const last = sh.getLastRow();
    const seen = new Set(last > 1
      ? sh.getRange(2, ID_COL, last - 1, 1).getValues().map(r => String(r[0]))
      : []);

    const out = [];
    rows.forEach(r => {
      if (!r || !r.isbn || seen.has(String(r.id))) return;
      seen.add(String(r.id));
      out.push([
        r.savedAt ? new Date(r.savedAt) : new Date(),
        String(r.isbn),
        r.title || '',
        r.authors || '',
        r.publisher || '',
        r.year || '',
        r.status || '',
        (r.price === null || r.price === undefined || r.price === '') ? '' : Number(r.price),
        r.currency || '',
        r.priceSource || '',
        r.batch || '',
        r.note || '',
        String(r.id || '')
      ]);
    });

    if (out.length) {
      sh.getRange(sh.getLastRow() + 1, 1, out.length, HEADERS.length).setValues(out);
    }
    return json_({ ok: true, added: out.length });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}
