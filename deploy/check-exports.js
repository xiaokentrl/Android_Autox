// 导出完整性自检：module.exports 里的每个名字必须在文件中有定义
const fs = require('fs');
const files = [
    'app/lib/store.js',
    'app/lib/compliance.js',
    'app/lib/dict.js',
    'app/lib/wifi.js',
    'app/lib/connect.js',
    'app/lib/engine.js',
    'app/lib/panel.js',
];
let bad = 0;
files.forEach(function (f) {
    const s = fs.readFileSync(f, 'utf8');
    const m = s.match(/module\.exports\s*=\s*\{([^}]*)\}/);
    if (!m) { console.log('SKIP（无对象导出）: ' + f); return; }
    m[1].split(',').map(function (x) { return x.trim(); }).filter(Boolean).forEach(function (name) {
        const re = new RegExp('function\\s+' + name + '\\b' +
            '|const\\s+' + name + '\\b' +
            '|let\\s+' + name + '\\b' +
            '|var\\s+' + name + '\\b');
        if (!re.test(s)) {
            console.log('未定义: ' + f + ' → ' + name);
            bad++;
        }
    });
});
console.log(bad ? '发现问题 ' + bad + ' 个' : '全部导出完整性 OK');
process.exit(bad ? 1 : 0);
