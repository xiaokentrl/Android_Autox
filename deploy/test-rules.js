// 自测：从页面脚本提取 applyRules/collectRules 依赖并单元测试规则链逻辑
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const html = fs.readFileSync('E:/Android_Autox/app/web/index.html', 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('no script'); process.exit(1); }

// —— DOM/浏览器桩 ——
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
const documentStub = {
    getElementById(id) { return els[id] || (els[id] = stubEl()); },
    querySelector() { return stubEl(); },
    querySelectorAll() { return []; },
    addEventListener() {},
    activeElement: null,
};
const sandbox = {
    document: documentStub,
    window: { matchMedia() { return { matches: false }; } },
    navigator: { userAgent: 'test' },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    toast(msg) { sandbox.__lastToast = msg; },
    console, JSON, Math, Date, RegExp, Object, Array, String, Number, parseInt, setTimeout, setInterval, clearInterval,
};
sandbox.window.localStorage = sandbox.localStorage;
sandbox.__lastToast = '';

vm.createContext(sandbox);
try { vm.runInContext(m[1], sandbox, { filename: 'page.js' }); } catch (e) { console.error('页面脚本执行异常: ' + e.message); process.exit(1); }

// —— 用例 ——
const A = sandbox.applyRules;
if (typeof A !== 'function') { console.error('FAIL: applyRules 未定义'); process.exit(1); }

let pass = 0, fail = 0;
function t(name, input, rules, expect) {
    const got = A(input, rules);
    const ok = JSON.stringify(got) === JSON.stringify(expect);
    ok ? pass++ : fail++;
    console.log((ok ? '✓' : '✗') + ' ' + name + (ok ? '' : '  got=' + JSON.stringify(got) + ' expect=' + JSON.stringify(expect)));
}

t('全小写', ['Demo0001', 'DEMO0002'], { lower: true, len: false, min: 0, max: 99, regex: '', blacklist: [], sortLen: false }, ['demo0001', 'demo0002']);
t('去重忽略大小写', ['Abc', 'ABC', 'abc'], { lower: false, len: false, min: 0, max: 99, regex: '', blacklist: [], sortLen: false }, ['Abc']);
t('长度过滤', ['abc', 'abcd', 'abcdefgh'], { lower: false, len: true, min: 3, max: 6, regex: '', blacklist: [], sortLen: false }, ['abc', 'abcd']);
t('正则保留匹配行', ['pass12', 'PASS12', 'X!'], { lower: false, len: false, min: 0, max: 99, regex: '^[a-z0-9]+$', blacklist: [], sortLen: false }, ['pass12']);
t('黑名单精确排除（忽略大小写）', ['admin', 'Admin1', 'ok123'], { lower: false, len: false, min: 0, max: 99, regex: '', blacklist: ['admin'], sortLen: false }, ['Admin1', 'ok123']);
t('长度升序排序', ['abcdefgh', 'abc', 'abcd'], { lower: false, len: false, min: 0, max: 99, regex: '', blacklist: [], sortLen: true }, ['abc', 'abcd', 'abcdefgh']);
t('组合链：小写→去重→长度→黑名单→排序', ['Home2024', 'home2024', 'ADMIN', 'abcdefghij'], { lower: true, len: true, min: 8, max: 16, regex: '', blacklist: ['admin'], sortLen: true }, ['home2024', 'abcdefghij']);
t('规则后为空是合法结果', ['abc'], { lower: true, len: true, min: 10, max: 16, regex: '', blacklist: [], sortLen: false }, []);

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
, blacklist: [], sortLen: false }, ['pass12']);
t('黑名单精确排除（忽略大小写）', ['admin', 'Admin1', 'ok123'], { lower: false, len: false, min: 0, max: 99, regex: '', blacklist: ['admin'], sortLen: false }, ['Admin1', 'ok123']);
t('长度升序排序', ['abcdefgh', 'abc', 'abcd'], { lower: false, len: false, min: 0, max: 99, regex: '', blacklist: [], sortLen: true }, ['abc', 'abcd', 'abcdefgh']);
t('组合链：小写→去重→长度→黑名单→排序', ['Home2024', 'home2024', 'ADMIN', 'abcdefghij'], { lower: true, len: true, min: 8, max: 16, regex: '', blacklist: ['admin'], sortLen: true }, ['home2024', 'abcdefghij']);
t('规则后为空是合法结果', ['abc'], { lower: true, len: true, min: 10, max: 16, regex: '', blacklist: [], sortLen: false }, []);

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
, blacklist: [], sortLen: false }, ['pass12']);
t('黑名单精确排除（忽略大小写）', ['admin', 'Admin1', 'ok123'], { lower: false, len: false, min: 0, max: 99, regex: '', blacklist: ['admin'], sortLen: false }, ['Admin1', 'ok123']);
t('长度升序排序', ['abcdefgh', 'abc', 'abcd'], { lower: false, len: false, min: 0, max: 99, regex: '', blacklist: [], sortLen: true }, ['abc', 'abcd', 'abcdefgh']);
t('组合链：小写→去重→长度→黑名单→排序', ['Home2024', 'home2024', 'ADMIN', 'abcdefghij'], { lower: true, len: true, min: 8, max: 16, regex: '', blacklist: ['admin'], sortLen: true }, ['home2024', 'abcdefghij']);
t('规则后为空是合法结果', ['abc'], { lower: true, len: true, min: 10, max: 16, regex: '', blacklist: [], sortLen: false }, []);

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
, blacklist: [], sortLen: false }, ['pass12']);
t('黑名单精确排除（忽略大小写）', ['admin', 'Admin1', 'ok123'], { lower: false, len: false, min: 0, max: 99, regex: '', blacklist: ['admin'], sortLen: false }, ['Admin1', 'ok123']);
t('长度升序排序', ['abcdefgh', 'abc', 'abcd'], { lower: false, len: false, min: 0, max: 99, regex: '', blacklist: [], sortLen: true }, ['abc', 'abcd', 'abcdefgh']);
t('组合链：小写→去重→长度→黑名单→排序', ['Home2024', 'home2024', 'ADMIN', 'abcdefghij'], { lower: true, len: true, min: 8, max: 16, regex: '', blacklist: ['admin'], sortLen: true }, ['home2024', 'abcdefghij']);
t('规则后为空是合法结果', ['abc'], { lower: true, len: true, min: 10, max: 16, regex: '', blacklist: [], sortLen: false }, []);

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
, blacklist: [], sortLen: false }, ['pass12']);
t('黑名单精确排除（忽略大小写）', ['admin', 'Admin1', 'ok123'], { lower: false, len: false, min: 0, max: 99, regex: '', blacklist: ['admin'], sortLen: false }, ['Admin1', 'ok123']);
t('长度升序排序', ['abcdefgh', 'abc', 'abcd'], { lower: false, len: false, min: 0, max: 99, regex: '', blacklist: [], sortLen: true }, ['abc', 'abcd', 'abcdefgh']);
t('组合链：小写→去重→长度→黑名单→排序', ['Home2024', 'home2024', 'ADMIN', 'abcdefghij'], { lower: true, len: true, min: 8, max: 16, regex: '', blacklist: ['admin'], sortLen: true }, ['home2024', 'abcdefghij']);
t('规则后为空是合法结果', ['abc'], { lower: true, len: true, min: 10, max: 16, regex: '', blacklist: [], sortLen: false }, []);

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
