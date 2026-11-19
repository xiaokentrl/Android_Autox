// 修复 index.html 中 rangeRe 行（$ 字符被写成换行的事故）
const fs = require('fs');
const p = 'E:/Android_Autox/app/web/index.html';
let s = fs.readFileSync(p, 'utf8');
const lines = s.split('\n');
let fixed = 0;
for (let i = 0; i < lines.length; i++) {
    if (lines[i].indexOf('rangeRe = new RegExp') >= 0 && lines[i].indexOf('$') < 0) {
        // 该行缺失 $：重建整行
        const BS = String.fromCharCode(92);
        const D = String.fromCharCode(36);
        lines[i] = "  const rangeRe = new RegExp('^(' + BS + 'd+)-(' + BS + 'd+)' + BS + 's*' + BS + '" + D + "');";
        fixed++;
        console.log('fixed line ' + (i + 1) + ': ' + lines[i]);
    }
}
fs.writeFileSync(p, lines.join('\n'));
console.log(fixed ? '已修复' : '未发现需修复的行（$ 可能已存在）');
