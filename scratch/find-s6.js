const fs=require('fs');
const s=fs.readFileSync('frontend/src/mock/dbStore.ts','utf8');
const i=s.indexOf("id: 's6'");
console.log(s.substring(i-30,i+700));