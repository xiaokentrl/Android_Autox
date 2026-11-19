// 修复测试用例行 —— 用函数形式 replace，规避 $ 特殊模式展开
const fs = require('fs');
const p = 'E:/Android_Autox/deploy/test-rules.js';
let s = fs.readFileSync(p, 'utf8');
const re = /t\('正则保留匹配行'[\s\S]*?\['pass12'\]\);/;
const DOLLAR = String.fromCharCode(36);
const fixed = "t('正则保留匹配行', ['pass12', 'PASS12', 'X!'], { lower: false, len: false, min: 0, max: 99, regex: '^[a-z0-9]+" + DOLLAR + "', blacklist: [], sortLen: false }, ['pass12']);";
if (!re.test(s)) { console.error('region miss'); process.exit(1); }
s = s.replace(re, function () { return fixed; });   // 关键：函数形式，$' 不再是特殊模式
fs.writeFileSync(p, s);
console.log('fixed');
