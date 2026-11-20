// 桥接契约自检：UI 发出的 nativeSend 命令必须在 main.js 的 handleCommand 中有分支
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'app', 'web', 'index.html'), 'utf8');
const main = fs.readFileSync(path.join(root, 'app', 'main.js'), 'utf8');

const uiCmds = new Set();
const reUi = /nativeSend\(\s*['"]([a-z0-9_]+)['"]/gi;
const reUiTernary = /nativeSend\(\s*[A-Za-z_$][\w$]*\s*\?\s*['"]([a-z0-9_]+)['"]\s*:\s*['"]([a-z0-9_]+)['"]/gi;
let m;
while ((m = reUi.exec(html))) uiCmds.add(m[1]);
while ((m = reUiTernary.exec(html))) {
    uiCmds.add(m[1]);
    uiCmds.add(m[2]);
}

const hcStart = main.indexOf('function handleCommand');
const hcNext = main.indexOf('\nsetInterval(', hcStart);
const body = hcStart >= 0
    ? main.slice(hcStart, hcNext > hcStart ? hcNext : main.length)
    : '';
const nativeCmds = new Set();
const reNative = /cmd\s*===\s*['"]([a-z0-9_]+)['"]/gi;
while ((m = reNative.exec(body))) nativeCmds.add(m[1]);

let bad = 0;
Array.from(uiCmds).sort().forEach(function (cmd) {
    if (!nativeCmds.has(cmd)) {
        console.log('缺少 handler: ' + cmd);
        bad++;
    }
});

const extra = Array.from(nativeCmds).filter(function (cmd) { return !uiCmds.has(cmd); }).sort();
if (extra.length) console.log('原生有分支但 UI 未发送（仅供参考）: ' + extra.join(', '));

if (bad) {
    console.log('桥接契约失败：' + bad + ' 个命令没有原生 handler');
} else {
    console.log('桥接契约 OK：UI 命令 ' + uiCmds.size + ' 个，全部有原生 handler');
}
process.exit(bad ? 1 : 0);
