const fs = require('fs');
const js = fs.readFileSync('public/app.js', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8');
const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
const used = new Set([...js.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]));
const missing = [...used].filter((id) => !ids.has(id));
console.log('referenced ids:', used.size);
console.log(missing.length ? 'MISSING: ' + missing.join(', ') : 'all referenced ids exist in index.html ✔');
