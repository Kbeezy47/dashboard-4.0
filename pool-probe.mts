import fs from 'fs';
const t = fs.readFileSync('kryptex-page.html', 'utf8');
console.log(t.slice(137300, 139200));
