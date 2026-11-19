// 逐行修复 main.js 中损坏的 SSID 引号剥离行（按行号定位，不经 bash 转义）
const fs = require('fs');
const p = 'E:/Android_Autox/app/main.js';
let s = fs.readFileSync(p, 'utf8');
const lines = s.split('\n');
let fixed = 0;
for (let i = 0; i < lines.length; i++) {
    if (lines[i].indexOf('raw.replace') >= 0) {
        const DQ = String.fromCharCode(34);   // "
        const DOL = String.fromCharCode(36);  // $
        const SL = String.fromCharCode(47);   // /
        lines[i] = "                ssid = raw.replace(/" + SL + "^" + DQ + "|" + DQ + DOL + SL + "g, " + DQ + "''" + DQ + ");";
        fixed++;
        console.log('fixed line ' + (i + 1) + ' → ' + lines[i]);
    }
}
if (!fixed) { console.error('未找到 raw.replace 行'); process.exit(1); }
fs.writeFileSync(p, lines.join('\n'));
console.log('done');
