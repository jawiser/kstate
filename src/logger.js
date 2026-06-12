function copyDetails(details){
  if(!details) return {};
  if(details instanceof Error){
    return { name: details.name, message: details.message };
  }
  try{
    return JSON.parse(JSON.stringify(details));
  }catch(_err){
    return { value: String(details) };
  }
}

export function createLogger({ maxEntries = 300, sink = console } = {}){
  const entries = [];

  function write(level, event, details){
    const entry = {
      at: new Date().toISOString(),
      level,
      event,
      details: copyDetails(details)
    };
    entries.push(entry);
    if(entries.length > maxEntries) entries.shift();
    if(sink && typeof sink[level] === 'function') sink[level]('[gift-triage]', event, entry.details);
    return entry;
  }

  return {
    info(event, details){ return write('info', event, details); },
    warn(event, details){ return write('warn', event, details); },
    error(event, details){ return write('error', event, details); },
    entries(){ return entries.slice(); }
  };
}
