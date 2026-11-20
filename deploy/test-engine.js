// 自测：多目标引擎状态机（vm 沙箱，桩掉 connect/compliance/dict/定时器/存储）
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const engineSrc = fs.readFileSync(path.join(__dirname, '..', 'app', 'lib', 'engine.js'), 'utf8');

function chainStub() {
    const o = {};
    o.clickable = function () { return { findOnce() { return null; } }; };
    o.findOnce = function () { return null; };
    return o;
}
function stubEl() {
    return { textContent: '', post(fn) { try { fn(); } catch (e) {} } };
}

function makeSandbox(opts) {
    const audits = [];
    const timeouts = [];
    const connectCalls = [];
    const sandbox = {
        auto: { root: {}, service: {} },
        sleep() {},
        toast() {},
        app: { startActivity() {} },
        currentPackage() { return 'com.android.settings'; },
        text() { return chainStub(); },
        className() { return chainStub(); },
        descContains() { return chainStub(); },
        descMatches() { return chainStub(); },
        textMatches() { return chainStub(); },
        swipe() {}, back() {},
        files: {
            cwd() { return '/x'; },
            exists() { return false; },
            createWithDirs() {}, write() {}, read() { return ''; }, append() {},
            listDir() { return []; }, remove() {},
        },
        __modules: {
            './compliance.js': {
                CAPS: { MAX_ATTEMPTS: 50, MIN_INTERVAL_SEC: 1 },
                config() { return { whitelist: opts.whitelist }; },
                checkTask(cfg) {
                    const targets = (Array.isArray(cfg.targets) && cfg.targets.length) ? cfg.targets : [cfg.ssid];
                    for (const t of targets) {
                        if (opts.whitelist.map(s => s.toLowerCase()).indexOf(String(t).toLowerCase()) < 0) {
                            audits.push(['TASK_REJECT', t]);
                            return { ok: false, reason: '目标网络不在白名单内：' + t };
                        }
                    }
                    if ((cfg.maxAttempts | 0) > 50) return { ok: false, reason: '超上限' };
                    return { ok: true, reason: '' };
                },
                audit(action, detail) { audits.push([action, detail]); },
            },
            './dict.js': { candidates(n) { return opts.candidates.slice(0, n); } },
            './connect.js': {
                attemptConnect(ssid, pwd, cfg) {
                    const r = opts.results.shift() || 'wrong_password';
                    connectCalls.push({
                        ssid: ssid, pwd: pwd, result: r,
                        hasStopCheck: !!(cfg && typeof cfg.stopCheck === 'function'),
                        hasPauseCheck: !!(cfg && typeof cfg.pauseCheck === 'function'),
                        hasSkipCheck: !!(cfg && typeof cfg.skipCheck === 'function'),
                        stopNow: !!(cfg && cfg.stopCheck && cfg.stopCheck()),
                    });
                    return r;
                },
            },
            './store.js': { appendLine() {} },
        },
        setTimeout(fn, ms) { timeouts.push({ fn: fn, ms: ms }); return timeouts.length; },
        setInterval() { return 0; }, clearInterval() {},
        ui: { run(fn) { fn(); }, finish() {} },
        module: { exports: {} },
    };
    sandbox.require = function (name) {
        if (sandbox.__modules[name]) return sandbox.__modules[name];
        throw new Error('unexpected require: ' + name);
    };
    sandbox.__audits = audits;
    sandbox.__timeouts = timeouts;
    sandbox.__connectCalls = connectCalls;
    vm.createContext(sandbox);
    vm.runInContext(engineSrc, sandbox, { filename: 'engine.js' });
    const E = sandbox.module.exports;
    return { sandbox: sandbox, E: E, audits: audits, timeouts: timeouts, connectCalls: connectCalls, pump: pump };
    function pump(maxIter) {
        let i = 0;
        while (timeouts.length && i < (maxIter || 300)) {
            const t = timeouts.shift();
            t.fn();
            i++;
        }
        return timeouts.length;
    }
}

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('PASS ' + name); }
    catch (e) { fail++; console.log('FAIL ' + name + ' → ' + e.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assert'); }

/* 1 合规拒绝 */
t('合规拒绝：不在白名单 → onDone(false) 且无 TASK_START', function () {
    const env = makeSandbox({ whitelist: ['AAA'], candidates: ['p1'], results: [] });
    const done = [];
    env.E.start({ ssid: 'NOT_IN_LIST', maxAttempts: 5, intervalSec: 2 }, {
        onLog() {}, onProgress() {}, onDone(ok, reason) { done.push([ok, reason]); },
    });
    assert(done.length === 1 && done[0][0] === false, 'onDone false');
    assert(done[0][1].indexOf('白名单') >= 0, 'reason 提到白名单');
    assert(env.audits.filter(a => a[0] === 'TASK_START').length === 0, '无 TASK_START');
    assert(env.audits.some(a => a[0] === 'TASK_REJECT'), '有 TASK_REJECT');
});

/* 2 单目标首条命中 */
t('单目标：首条命中 → onDone(true) + TASK_SUCCESS + HIT', function () {
    const env = makeSandbox({ whitelist: ['AAA'], candidates: ['p1', 'p2'], results: ['connected'] });
    const done = []; const logs = [];
    env.E.start({ ssid: 'AAA', maxAttempts: 5, intervalSec: 2 }, {
        onLog(t2, c) { logs.push([t2, c]); }, onProgress() {},
        onDone(ok, reason) { done.push([ok, reason]); },
    });
    env.pump();
    assert(done.length === 1 && done[0][0] === true, 'onDone true');
    assert(env.audits.some(a => a[0] === 'TASK_SUCCESS'), 'TASK_SUCCESS');
    assert(env.audits.some(a => a[0] === 'HIT'), 'HIT');
    assert(env.connectCalls.length === 1 && env.connectCalls[0].pwd === 'p1', '只尝试 1 条');
});

/* 3 双目标：目标1 全错 → 目标2 命中 */
t('双目标：目标1 全错 → 目标2 命中 → 成功结束', function () {
    const env = makeSandbox({
        whitelist: ['AAA', 'BBB'], candidates: ['p1', 'p2'],
        results: ['wrong_password', 'wrong_password', 'wrong_password', 'connected'],
    });
    const done = []; const logs = [];
    env.E.start({ targets: ['AAA', 'BBB'], maxAttempts: 5, intervalSec: 2 }, {
        onLog(t2, c) { logs.push([t2, c]); }, onProgress() {},
        onDone(ok, reason) { done.push([ok, reason]); },
    });
    env.pump();
    assert(done.length === 1 && done[0][0] === true, 'onDone true');
    const aaa = env.connectCalls.filter(c => c.ssid === 'AAA').length;
    const bbb = env.connectCalls.filter(c => c.ssid === 'BBB').length;
    assert(aaa === 2, 'AAA 尝试 2 条（字典耗尽）');
    assert(bbb === 2, 'BBB 第 2 条命中');
    assert(env.audits.some(a => a[0] === 'HIT' && a[1].indexOf('BBB') >= 0), 'HIT 指向 BBB');
    assert(logs.some(l => l[0].indexOf('目标 2/2') >= 0), '日志含 目标 2/2');
});

/* 4 命中策略 continue */
t('命中策略 continue：两目标都命中 → 全部处理完毕', function () {
    const env = makeSandbox({
        whitelist: ['AAA', 'BBB'], candidates: ['p1'],
        results: ['connected', 'connected'],
    });
    const done = [];
    env.E.start({ targets: ['AAA', 'BBB'], maxAttempts: 5, intervalSec: 2, onHit: 'continue' }, {
        onLog() {}, onProgress() {}, onDone(ok, reason) { done.push([ok, reason]); },
    });
    env.pump();
    assert(done.length === 1 && done[0][0] === true, 'onDone true');
    assert(env.audits.filter(a => a[0] === 'HIT').length === 2, '两条 HIT');
});

/* 5 手动停止 */
t('手动停止 → TASK_END 手动停止', function () {
    const env = makeSandbox({
        whitelist: ['AAA'], candidates: ['p1', 'p2', 'p3'],
        results: ['wrong_password', 'wrong_password', 'wrong_password'],
    });
    const done = [];
    env.E.start({ ssid: 'AAA', maxAttempts: 50, intervalSec: 2 }, {
        onLog() {}, onProgress() {}, onDone(ok, reason) { done.push([ok, reason]); },
    });
    env.pump(2);
    env.E.stop();
    env.pump();
    assert(done.length === 1 && done[0][0] === false && done[0][1] === '手动停止', '手动停止');
    assert(env.audits.some(a => a[0] === 'TASK_STOP_REQUEST'), '停止请求审计');
});

/* 6 暂停/继续状态 */
t('暂停/继续：isPaused 切换', function () {
    const env = makeSandbox({ whitelist: ['AAA'], candidates: ['p1'], results: [] });
    assert(env.E.isPaused() === false, '初始 false');
    env.E.pause();
    assert(env.E.isPaused() === true, 'pause true');
    env.E.resume();
    assert(env.E.isPaused() === false, 'resume false');
});

/* 7 字典为空 */
t('字典为空 → onDone(false, 字典为空)', function () {
    const env = makeSandbox({ whitelist: ['AAA'], candidates: [], results: [] });
    const done = [];
    env.E.start({ ssid: 'AAA', maxAttempts: 5, intervalSec: 2 }, {
        onLog() {}, onProgress() {}, onDone(ok, reason) { done.push([ok, reason]); },
    });
    assert(done.length === 1 && done[0][0] === false && done[0][1] === '字典为空', '字典为空');
});

/* 8 目标切换时进度归零 */
t('目标切换：进度按新目标归零', function () {
    const env = makeSandbox({
        whitelist: ['AAA', 'BBB'], candidates: ['p1'],
        results: ['wrong_password', 'wrong_password'],
    });
    const progress = [];
    env.E.start({ targets: ['AAA', 'BBB'], maxAttempts: 5, intervalSec: 2 }, {
        onLog() {}, onProgress(p) { progress.push(p); }, onDone() {},
    });
    env.pump();
    const aaaProgress = progress.filter(p => p.target === 'AAA');
    const bbbProgress = progress.filter(p => p.target === 'BBB');
    assert(aaaProgress.some(p => p.tried === 1), 'AAA 有 tried=1');
    assert(bbbProgress.some(p => p.tried === 1), 'BBB 重新从 tried=1 计数');
    assert(!progress.some(p => p.tried === 2), '没有跨目标累计的 tried=2');
});

/* 9 控制回调下沉：connect 能拿到 stop/pause/skip 检查，且 stop 后回调返回 true */
t('控制回调下沉：connect 收到 stopCheck/pauseCheck/skipCheck', function () {
    const env = makeSandbox({
        whitelist: ['AAA'], candidates: ['p1', 'p2'],
        results: ['wrong_password', 'wrong_password'],
    });
    const done = [];
    env.E.start({ ssid: 'AAA', maxAttempts: 50, intervalSec: 2 }, {
        onLog() {}, onProgress() {}, onDone(ok, reason) { done.push([ok, reason]); },
    });
    env.pump(1); // 只跑到第 1 次 attemptConnect
    assert(env.connectCalls.length >= 1, '至少一次连接尝试');
    const c0 = env.connectCalls[0];
    assert(c0.hasStopCheck && c0.hasPauseCheck && c0.hasSkipCheck, '三个控制回调都传给 connect');
    assert(c0.stopNow === false, '初始 stopCheck 为 false');
    // 停止后任务应立即结束，不再发起新的连接尝试
    const callsBeforeStop = env.connectCalls.length;
    env.E.stop();
    env.pump();
    assert(env.connectCalls.length === callsBeforeStop, 'stop 后不再有新的连接尝试');
    assert(done.length === 1 && done[0][1] === '手动停止', 'stop 后任务以手动停止结束');
});

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
