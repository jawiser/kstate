export function cleanIsbn(raw){
  return String(raw || '').replace(/[^0-9Xx]/g, '').toUpperCase();
}

export function isValidIsbn10(value){
  const isbn = cleanIsbn(value);
  if(!/^\d{9}[\dX]$/.test(isbn)) return false;
  let sum = 0;
  for(let i = 0; i < 10; i++){
    const char = isbn[i];
    const digit = char === 'X' ? 10 : Number(char);
    sum += (10 - i) * digit;
  }
  return sum % 11 === 0;
}

export function isValidIsbn13(value){
  const isbn = cleanIsbn(value);
  if(!/^97[89]\d{10}$/.test(isbn)) return false;
  let sum = 0;
  for(let i = 0; i < 12; i++){
    sum += Number(isbn[i]) * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  return check === Number(isbn[12]);
}

export function validIsbn(value){
  const isbn = cleanIsbn(value);
  return isValidIsbn13(isbn) || isValidIsbn10(isbn);
}

export function isBooklandIsbn13(value){
  return isValidIsbn13(value);
}

export function isbn13to10(value){
  const isbn = cleanIsbn(value);
  if(!/^978\d{10}$/.test(isbn) || !isValidIsbn13(isbn)) return null;
  const core = isbn.slice(3, 12);
  let sum = 0;
  for(let i = 0; i < 9; i++) sum += (10 - i) * Number(core[i]);
  const check = (11 - (sum % 11)) % 11;
  return core + (check === 10 ? 'X' : String(check));
}

export function lookupForms(value){
  const isbn = cleanIsbn(value);
  if(!validIsbn(isbn)) return [];
  const forms = [isbn];
  const alt = isbn.length === 13 ? isbn13to10(isbn) : null;
  if(alt) forms.push(alt);
  return forms;
}
