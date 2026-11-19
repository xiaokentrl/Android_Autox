// 自测：规则链 applyRules 单元测试（从页面脚本提取到 vm 沙箱执行）
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('E:/Android_Autox/app/web/index.html', 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('no script'); process.exit(1); }

function stubEl() {
    return {
        textContent: '', innerHTML: '', value: '', checked: false,
        style: {}, classList: { add(){}, remove(){}, toggle(){} },
        parentElement: { style: {} },
        post(fn) { try { fn(); } catch (e) {} },
        setText(t) { this.textContent = t; },
        addEventListener() {}, setOnTouchListener() {}, on() { return this; },
        getX() { return 0; }, getY() { return 0; }, close() {},
    };
}
const els = {};
const sandbox = {
    document: {
        getElementById(id) { return els[id] || (els[id] = stubEl()); },
        querySelector() { return stubEl(); },
        querySelectorAll() { return []; },
        addEventListener() {},
    },
    window: {}, navigator: { userAgent: 'test' },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    toast(msg) { sandbox.__lastToast = msg; },
    console, JSON, Math, Date, RegExp, Object, Array, String, Number, parseInt,
    setTimeout() {}, setInterval() {}, clearInterval() {},
};
sandbox.window.localStorage = sandbox.localStorage;
sandbox.__lastToast = '';

vm.createContext(sandbox);
try {
    vm.runInContext(m[1], sandbox, { filename: 'page.js' });
} catch (e) {
    console.error('页面脚本执行异常: ' + e.message);
    process.exit(1);
}

const A = sandbox.applyRules;
if (typeof A !== 'function') { console.error('FAIL: applyRules 未定义'); process.exit(1); }

const D = String.fromCharCode(36); // '$'（避免 bash 转义问题）
let pass = 0, fail = 0;
function t(name, input, rules, expect) {
    const got = A(input, rules);
    const ok = JSON.stringify(got) === JSON.stringify(expect);
    ok ? pass++ : fail++;
    console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  got=' + JSON.stringify(got) + ' expect=' + JSON.stringify(expect)));
}

t('全小写', ['Demo0001', 'DEMO0002'],
  { lower: true, len: false, min: 0, max: 99, regex: '', blacklist: [], sortLen: false },
  ['demo0001', 'demo0002']);

t('去重忽略大小写', ['Abc', 'ABC', 'abc'],
  { lower: false, len: false, min: 0, max: 99, regex: '', blacklist: [], sortLen: false },
  ['Abc']);

t('长度过滤', ['abc', 'abcd', 'abcdefgh'],
  { lower: false, len: true, min: 3, max: 6, regex: '', blacklist: [], sortLen: false },
  ['abc', 'abcd']);

t('正则保留匹配行', ['pass12', 'PASS12', 'X!'],
  { lower: false, len: false, min: 0, max: 99, regex: '^[a-z0-9]+' + D, blacklist: [], sortLen: false },
  ['pass12']);

t('黑名单精确排除（忽略大小写）', ['admin', 'Admin1', 'ok123'],
  { lower: false, len: false, min: 0, max: 99, regex: '', blacklist: ['admin'], sortLen: false },
  ['Admin1', 'ok123']);

t('长度升序排序', ['abcdefgh', 'abc', 'abcd'],
  { lower: false, len: false, min: 0, max: 99, regex: '', blacklist: [], sortLen: true },
  ['abc', 'abcd', 'abcdefgh']);

t('组合链：小写→去重→长度→黑名单→排序', ['Home2024', 'home2024', 'ADMIN', 'abcdefghij'],
  { lower: true, len: true, min: 8, max: 16, regex: '', blacklist: ['admin'], sortLen: true },
  ['home2024', 'abcdefghij']);

t('规则后为空是合法结果', ['abc'],
  { lower: true, len: true, min: 10, max: 16, regex: '', blacklist: [], sortLen: false },
  []);

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
