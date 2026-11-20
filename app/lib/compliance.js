/**
 * compliance.js — 合规约束层（强制，不可关闭）
 *
 * 对应原型页面的约定：
 *   - 目标网络白名单：不在白名单内的 SSID 一律拒绝执行
 *   - 尝试次数硬上限：50 次，任何配置不得超过
 *   - 最小尝试间隔下限：1 秒，任何配置不得低于
 *   - 审计日志：强制记录授权确认、任务开始/停止，不可关闭
 *
 * 本工具仅用于自有网络或已获书面授权的网络环境测试。
 */
const store = require('./store.js');

/** 硬上限（代码级，改 UI 也绕不过） */
const CAPS = {
    MAX_ATTEMPTS: 50,      // 每目标尝试次数上限
    MIN_INTERVAL_SEC: 1,   // 最小尝试间隔
    MAX_TARGETS: 20,       // 单任务目标数上限（防止 N×50 无限放大）
};

/** 默认配置（首次运行时落盘） */
const DEFAULT_CONFIG = {
    whitelist: ['MyHome_5G', 'Office_Test'],
    maxAttemptsCap: CAPS.MAX_ATTEMPTS,
    minIntervalSec: CAPS.MIN_INTERVAL_SEC,
    taskConfirm: true,
};

function config() {
    return Object.assign({}, DEFAULT_CONFIG, store.load('config.json', {}));
}

function saveConfig(patch) {
    const merged = Object.assign({}, config(), patch);
    // 合规项不可放宽
    merged.maxAttemptsCap = CAPS.MAX_ATTEMPTS;
    merged.minIntervalSec = CAPS.MIN_INTERVAL_SEC;
    store.save('config.json', merged);
    return merged;
}

function now() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
        + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

/** 审计日志（强制记录，追加写入，无关闭开关） */
function audit(action, detail) {
    const line = '[' + now() + '] ' + action + (detail ? ' | ' + detail : '');
    store.appendLine('audit.log', line);
    console.log('[审计] ' + line);
}

/** 授权确认记录 */
function recordAuthConfirmation() {
    audit('AUTH_CONFIRM', '用户确认仅对自有或已获授权网络测试');
}

/**
 * 任务配置校验：白名单 + 硬上限
 * @returns {{ok: boolean, reason: string}}
 */
function checkTask(cfg) {
    const conf = config();
    // 多目标：cfg.targets（白名单顺序）优先，单目标退化为 cfg.ssid
    const targets = (Array.isArray(cfg && cfg.targets) && cfg.targets.length)
        ? cfg.targets : (cfg && cfg.ssid ? [cfg.ssid] : []);
    if (!targets.length) {
        return { ok: false, reason: '缺少目标网络' };
    }
    if (targets.length > CAPS.MAX_TARGETS) {
        audit('TASK_REJECT', '目标数 ' + targets.length + ' 超过上限 ' + CAPS.MAX_TARGETS);
        return { ok: false, reason: '目标数超出上限（≤' + CAPS.MAX_TARGETS + ' 个）' };
    }
    const wl = conf.whitelist.map(s => String(s).trim().toLowerCase());
    for (let i = 0; i < targets.length; i++) {
        const t = String(targets[i]).trim();
        if (wl.indexOf(t.toLowerCase()) < 0) {
            audit('TASK_REJECT', 'SSID 不在白名单: ' + t);
            return { ok: false, reason: '目标网络不在白名单内：' + t };
        }
    }
    if ((cfg.maxAttempts | 0) > conf.maxAttemptsCap || (cfg.maxAttempts | 0) <= 0) {
        return { ok: false, reason: '尝试次数超出硬上限（≤' + conf.maxAttemptsCap + '）' };
    }
    if ((cfg.intervalSec | 0) < conf.minIntervalSec) {
        return { ok: false, reason: '尝试间隔低于下限（≥' + conf.minIntervalSec + ' 秒）' };
    }
    return { ok: true, reason: '' };
}

module.exports = { CAPS, config, saveConfig, audit, recordAuthConfirmation, checkTask };
