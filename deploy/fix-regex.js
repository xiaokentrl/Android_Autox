// 修复 main.js 中被 bash 转义损坏的正则（get_logs tail 函数）
const fs = require('fs');
const p = 'E:/Android_Autox/app/main.js';
let s = fs.readFileSync(p, 'utf8');

// 定位损坏区域：get_logs tail 函数里的 split
const idx = s.indexOf("files.read(p).split(");
if (idx < 0) { console.error('未找到 split 起点'); process.exit(1); }
console.log('损坏区域字节：');
const region = s.slice(idx, idx + 40);
for (let i = 0; i < region.length; i++) {
    process.stdout.write(region.charCodeAt(i) + ' ');
}
console.log('\n区域文本：' + JSON.stringify(region));

// 重建：从 'split(' 到第一个 '/)' 全部替换为正确的正则
const BS = String.fromCharCode(92);
const endIdx = s.indexOf('/)', idx);
if (endIdx < 0) { console.error('未找到 /) 结束'); process.exit(1); }
const before = s.slice(0, idx);
const after = s.slice(endIdx + 2);
const fixed = 'split(/' + BS + 'r?' + BS + 'n/)';
s = before + fixed + after;
fs.writeFileSync(p, s);
console.log('已修复为：' + fixed);
