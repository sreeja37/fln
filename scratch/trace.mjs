// trace.mjs — print intermediate values from the live mock data
// Simulates the exact filter the running app would apply.
import fs from 'fs';
import path from 'path';

const file = 'C:/Users/sreej/OneDrive/Desktop/iitrpr-fln/fln/frontend/src/mock/dbStore.ts';
const src = fs.readFileSync(file, 'utf8');

// Extract the classes array literal from the seed.
function extract(label) {
  const re = new RegExp(`const\\s+${label}\\s*:\\s*[A-Za-z._]+\\[\\]\\s*=\\s*\\[([\\s\\S]*?)\\n\\s*\\];`, 'm');
  const m = src.match(re);
  if (!m) throw new Error(`Could not find ${label}`);
  const body = m[1];
  const objRe = /\{[^{}]*\}/g;
  const items = body.match(objRe) || [];
  return items.map((s) => {
    // Build a minimal object
    const obj = {};
    const kvs = s.match(/(\w+)\s*:\s*('([^']*)'|"([^"]*)"|true|false|null|-?\d+(?:\.\d+)?)/g) || [];
    for (const kv of kvs) {
      const mm = kv.match(/^(\w+)\s*:\s*('([^']*)'|"([^"]*)"|true|false|null|-?\d+(?:\.\d+)?)$/);
      if (!mm) continue;
      const k = mm[1];
      const v = mm[3] !== undefined ? mm[3] : mm[4] !== undefined ? mm[4] : mm[2];
      if (v === 'true') obj[k] = true;
      else if (v === 'false') obj[k] = false;
      else if (v === 'null') obj[k] = null;
      else if (/^-?\d+(\.\d+)?$/.test(v)) obj[k] = Number(v);
      else obj[k] = v;
    }
    return obj;
  });
}

const classes = extract('classes');
const users = extract('users');

// 1) Find Meena Kumari
const meena = users.find((u) => u.email === 'gps-amb-003.t01@fln.org');
console.log('--- 1. POST /api/auth/login (lookup by email) ---');
console.log('email  :', 'gps-amb-003.t01@fln.org');
console.log('user   :', JSON.stringify(meena, null, 2));
console.log();

console.log('--- 2. currentUser after login ---');
const currentUser = meena;
console.log('id        :', currentUser.id);
console.log('email     :', currentUser.email);
console.log('schoolId  :', currentUser.schoolId);
console.log('teacherId :', currentUser.id); // for TEACHER, teacherId === user.id
console.log();

console.log('--- 3. GET /api/auth/me (full payload) ---');
console.log(JSON.stringify({ user: currentUser }, null, 2));
console.log();

console.log('--- 4. GET /api/classes (raw db.classes) ---');
console.log('count:', classes.length);
console.log(JSON.stringify(classes, null, 2));
console.log();

console.log('--- 5. /api/classes AFTER server filter (schoolId === currentUser.schoolId) ---');
const filtered = classes.filter((c) => c.schoolId === currentUser.schoolId);
console.log('count:', filtered.length);
console.log(JSON.stringify(filtered, null, 2));
console.log();

console.log('--- 6. Dashboard receives this `classes` array directly. No second filter. ---');
console.log('ClassGroup options that reach <TeacherClassSelector> =', filtered.map((c) => `${c.id}:${c.className}-${c.section}`));
console.log();

console.log('--- 7. Sort + default-grade logic in TeacherDashboard.fetchTeacherData ---');
const sorted = [...filtered].sort((a, b) => {
  const an = parseInt(String(a.className).match(/\d+/)?.[0] ?? '0', 10);
  const bn = parseInt(String(b.className).match(/\d+/)?.[0] ?? '0', 10);
  return an - bn;
});
console.log('sorted   :', sorted.map((c) => `${c.id}:${c.className}-${c.section}`));
console.log('defaultId:', sorted.length > 0 ? sorted[0].id : '(none)');
console.log('active   :', sorted.length > 0 ? sorted[0] : null);