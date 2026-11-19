/**
 * engine.js — 轮询引擎（多目标批量轮询 + 真实连接）
 *
 * 已实现：
 *   - 多目标：cfg.targets（白名单顺序）逐个 AP 执行字典轮询，单目标时退化为 [cfg.ssid]
 *   - 命中策略：cfg.onHit = 'stop'（默认，命中即停）| 'continue'（记录后继续下一个目标）
 *   - 暂停/继续、停止、间隔节流、次数上限、审计接入
 *   - attemptConnect 走 lib/connect.js 无障碍自动化（真实连接系统 WLAN）
 *
 * 仅对 compliance 白名单内的网络执行（授权声明制，见总纲）。
 */
const compliance = require('./compliance.js');
const dict = require('./dict.js');
const connect = require('./connect.js');
const store = require('./store.js');

const state = {
    running: false,
    stopFlag: false,
    pausedFlag: false,
};

/** 无障碍服务是否就绪（auto.root 未就绪时抛异常） */
function accessibilityReady() {
    try { return !!(auto && auto.root); } catch (e) { return false; }
}

function start(cfg, hooks) {
    if (state.running) {
        hooks.onDone(false, '已有任务在运行');
        return;
    }
    if (!accessibilityReady()) {
        store.appendLine('connect.log', new Date().toLocaleTimeString() + ' 无障碍未就绪（auto.root 检查失败）');
        hooks.onLog('无障碍服务未开启，请在 设置 › 权限向导 中开启后重试', 'fail');
        hooks.onDone(false, '无障碍服务未开启');
        return;
    }
    const check = compliance.checkTask(cfg);
    if (!check.ok) {
        hooks.onLog('合规校验未通过：' + check.reason, 'fail');
        hooks.onDone(false, check.reason);
        return;
    }

    const targets = (Array.isArray(cfg.targets) && cfg.targets.length)
        ? cfg.targets : [cfg.ssid];
    const onHitContinue = cfg.onHit === 'continue';

    const intervalMs = Math.max(cfg.intervalSec | 0, compliance.CAPS.MIN_INTERVAL_SEC) * 1000;
    const candidates = dict.candidates(cfg.maxAttempts);
    if (candidates.length === 0) {
        hooks.onLog('字典为空，请在 dicts/ 目录放入字典文件', 'fail');
        hooks.onDone(false, '字典为空');
        return;
    }

    state.running = true;
    state.stopFlag = false;
    state.pausedFlag = false;
    state.skipFlag = false;
    cfg.skipCheck = function () { return state.skipFlag; };
    compliance.audit('TASK_START',
        'targets=[' + targets.join(', ') + '] maxAttempts=' + candidates.length
        + ' interval=' + intervalMs + 'ms onHit=' + (onHitContinue ? 'continue' : 'stop'));
    hooks.onLog('任务开始 · ' + targets.length + ' 个目标 · 每目标待试 '
        + candidates.length + ' 条');

    let ti = 0;          // 当前目标下标
    let tried = 0;       // 当前目标已尝试条数
    let hitTargets = []; // 已命中的目标
    const startedAt = Date.now();

    function finish(success, reason) {
        state.running = false;
        compliance.audit(success ? 'TASK_SUCCESS' : 'TASK_END',
            reason + (hitTargets.length ? ' | 命中: ' + hitTargets.join(', ') : ''));
        hooks.onLog(success ? '任务成功结束' : '任务结束（' + reason + '）',
            success ? 'ok' : 'fail');
        hooks.onDone(success, reason);
    }

    function nextTarget() {
        if (state.stopFlag) { finish(false, '手动停止'); return; }
        if (ti >= targets.length) {
            finish(hitTargets.length > 0,
                hitTargets.length ? '全部目标处理完毕' : '全部目标尝试完毕，未命中');
            return;
        }
        const ssid = targets[ti];
        tried = 0;
        hooks.onLog('目标 ' + (ti + 1) + '/' + targets.length + '：' + ssid + ' 开始');
        hooks.onProgress({ tried: 0, total: candidates.length, target: ssid });
        nextAttempt(ssid);
    }

    function nextAttempt(ssid) {
        if (state.stopFlag) { finish(false, '手动停止'); return; }
        // 暂停：阻塞等待（引擎运行在独立线程，允许 sleep）
        while (state.pausedFlag && !state.stopFlag) { sleep(400); }
        if (state.stopFlag) { finish(false, '手动停止'); return; }
        if (tried >= candidates.length) {
            hooks.onLog('目标 ' + ssid + ' 字典尝试完毕，未命中');
            ti++;
            setTimeout(nextTarget, intervalMs);
            return;
        }

        tried++;
        const pwd = candidates[tried - 1];
        const result = attemptConnect(ssid, pwd, cfg);
        if (state.skipFlag) state.skipFlag = false;

        hooks.onProgress({ tried: tried, total: candidates.length, target: ssid });
        if (result === 'connected') {
            hooks.onProgress({ tried: tried, total: candidates.length, currentPwd: pwd, target: ssid });
            hooks.onLog('第 ' + tried + ' 条 · 命中（' + ssid + '）', 'ok');
            compliance.audit('HIT', 'ssid=' + ssid + ' 尝试序号=' + tried);
            hitTargets.push(ssid);
            if (hooks.onHit) hooks.onHit(ssid);
            if (!onHitContinue) { finish(true, '命中 ' + ssid); return; }
            hooks.onLog('命中后继续（按任务设置）', 'ok');
            ti++;
            setTimeout(nextTarget, intervalMs);
            return;
        } else if (result === 'timeout') {
            hooks.onLog('第 ' + tried + ' 条 · 连接超时', 'fail');
        } else if (result === 'not_found') {
            hooks.onLog('第 ' + tried + ' 条 · 列表中未找到该网络', 'fail');
        } else if (result === 'saved') {
            hooks.onLog('第 ' + tried + ' 条 · 已在系统保存列表（密码已知），跳过');
        } else if (result === 'skipped') {
            hooks.onLog('第 ' + tried + ' 条 · 用户跳过', 'fail');
        } else {
            hooks.onLog('第 ' + tried + ' 条 · 密码错误', 'fail');
        }

        const elapsedMin = (Date.now() - startedAt) / 60000;
        const speed = elapsedMin > 0 ? (tried / elapsedMin).toFixed(1) : '0';
        hooks.onProgress({ tried: tried, total: candidates.length, speed: speed, target: ssid });
        setTimeout(function () { nextAttempt(ssid); }, intervalMs);
    }

    setTimeout(nextTarget, 300);
}

/** 跳过当前尝试的等待（结果作废，立即进入下一条） */
function skip() {
    if (state.running) state.skipFlag = true;
}

/** 手动停止（下个间隔生效） */
function stop() {
    if (state.running) {
        state.stopFlag = true;
        compliance.audit('TASK_STOP_REQUEST', '用户手动停止');
    }
}

/**
 * 连接尝试：无障碍自动化系统 WLAN 设置（lib/connect.js）
 * 返回 'connected' | 'wrong_password' | 'timeout' | 'not_found' | 'saved'
 */
function attemptConnect(ssid, pwd, cfg) {
    return connect.attemptConnect(ssid, pwd, cfg);
}

function pause() { state.pausedFlag = true; compliance.audit('TASK_PAUSE', ''); }
function resume() { state.pausedFlag = false; compliance.audit('TASK_RESUME', ''); }
function isPaused() { return !!state.pausedFlag; }
function isRunning() { return state.running; }

module.exports = { start, stop, skip, pause, resume, isPaused, isRunning };
