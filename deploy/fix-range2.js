// 修复 rangeRe 多余的 \$ 转义（RegExp 构造串中 $ 直接写即可）
const fs = require('fs');
const p = 'E:/Android_Autox/app/web/index.html';
let s = fs.readFileSync(p, 'utf8');
const BS = String.fromCharCode(92);
const D = String.fromCharCode(36);
const broken = "'+ BS + 'd+)' + BS + 's*' + BS + '" + D + "');";
const fixed = "'+ BS + 'd+)' + BS + D + " + String.fromCharCode(39,39) + ");";
const n = s.split(broken).length - 1;
if (n !== 1) { console.error('broken count=' + n); process.exit(1); }
s = s.replace(broken, fixed);
fs.writeFileSync(p, s);
console.log('rangeRe 修复完成');
