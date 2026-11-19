// 修复被 bash 转义弄坏的 SSID 引号剥离表达式
const fs = require('fs');
const p = 'E:/Android_Autox/app/main.js';
let s = fs.readFileSync(p, 'utf8');
const DQ = String.fromCharCode(34);
const broken = "ssid = raw.replace(/^\"" + DQ + " + ''" + DQ + " + '', '');";
const fixed = "ssid = raw.replace(/^\"|" + DQ + "\$/g, '');";
if (s.indexOf(broken) < 0) { console.error('broken not found'); process.exit(1); }
s = s.replace(broken, fixed);
fs.writeFileSync(p, s);
console.log('fixed');
