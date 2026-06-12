function csvCell(value){
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
}

export function historyToCsv(history){
  const headers = ['timestamp', 'isbn', 'verdict', 'title', 'source', 'error_category'];
  const rows = (Array.isArray(history) ? history : []).map(entry => [
    entry.at,
    entry.isbn,
    entry.verdict,
    entry.title || entry.label || '',
    entry.source || '',
    entry.errorCategory || ''
  ]);
  return [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\n') + '\n';
}

export function diagnosticsToJson({ settings, history, logs, capabilities }){
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    settings: {
      sruBase: settings.sruBase,
      proxyConfigured: Boolean(settings.proxyBase),
      primoVid: settings.primoVid
    },
    capabilities,
    historyCount: Array.isArray(history) ? history.length : 0,
    logs: Array.isArray(logs) ? logs : []
  }, null, 2);
}

export function downloadText(filename, text, type = 'text/plain'){
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
