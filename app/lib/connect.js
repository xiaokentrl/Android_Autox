/**
 * connect.js — 真实连接引擎（无障碍自动化系统 WLAN 设置）
 *
 * 仅由 engine.js 对 compliance 白名单内的网络调用（授权声明制，见总纲）。
 * 会话化：同一目标的连续密码尝试复用同一个 WLAN 页，密码错误后留在页内重试，
 * 不再每个密码都进出设置页（大幅减少反复刷新/下拉）。目标切换或结束时关闭会话。
 * 结果：'connected' | 'wrong_password' | 'timeout' | 'not_found' | 'saved' | 'skipped' | 'stopped'
 *
 * 选择器按 MIUI marble / Android 15 实测标定（probe-ui.js 转储）。
 */
const W = require('./store.js'); // 复用日志落盘

const TAG = 'connect';
const FIND_MAX_SCREENS = 8;   // SSID 列表最多向下滚几屏
const RESULT_TIMEOUT_MS = 20000; // 连接结果等待上限

// 会话状态：复用同一个 WLAN 页连续尝试多个密码
var session = {
    active: false,
    ssid: '',
};

function clog(msg) {
    W.appendLine('connect.log', new Date().toLocaleTimeString() + ' ' + msg);
}

function sleepMs(ms) { sleep(ms); }

/**
 * 统一控制检查：在各等待/滚动循环中调用，让 stop/pause/skip 能即时生效。
 * 暂停时阻塞等待（connect 运行在引擎工作线程，允许 sleep）；停止/跳过立即返回标记。
 * @returns null | 'stopped' | 'skipped'
 */
function checkControl(cfg) {
    if (!cfg) return null;
    var stopped = (typeof cfg.stopCheck === 'function' && cfg.stopCheck());
    if (stopped) return 'stopped';
    if (typeof cfg.skipCheck === 'function' && cfg.skipCheck()) return 'skipped';
    while (typeof cfg.pauseCheck === 'function' && cfg.pauseCheck()) {
        if (typeof cfg.stopCheck === 'function' && cfg.stopCheck()) return 'stopped';
        sleepMs(300);
    }
    if (typeof cfg.stopCheck === 'function' && cfg.stopCheck()) return 'stopped';
    return null;
}

/** 打开系统 WLAN 设置页 */
function openWifiSettings() {
    app.startActivity({ action: 'android.settings.WIFI_SETTINGS' });
    sleepMs(2500);
    // 关闭可能残留的系统弹窗（如「开启 WLAN」确认）
    let ok = textMatches(/(确定|允许|好)/).findOnce();
    if (ok && ok.clickable()) { ok.click(); sleepMs(800); }
}

/** 滚动回 WLAN 列表顶部（上次尝试可能停在很深处） */
function scrollTop() {
    for (let i = 0; i < 4; i++) {
        swipe(540, 800, 540, 2100, 250);
        sleepMs(400);
    }
    sleepMs(500);
}

/** 在 WLAN 列表中查找目标 SSID：先查当前屏，找不到再逐屏下滑，滚到底才回顶重试一轮 */
function findSsidEntry(ssid, cfg) {
    // 不无条件 scrollTop：目标常在首屏，先直接找，避免无谓的反复下拉
    var round = 0;
    while (round < 2) {
        for (let screen = 0; screen < FIND_MAX_SCREENS; screen++) {
            var ctl = checkControl(cfg);
            if (ctl) return ctl;
            let t = text(ssid).findOnce();
            if (t) {
                let node = t;
                for (let up = 0; up < 6 && node; up++) {
                    if (node.clickable()) return node;
                    node = node.parent();
                }
                return t; // 找不到可点击父项就直接点文本
            }
            // 当前屏没有 → 向下滚一屏
            swipe(540, 2000, 540, 600, 300);
            sleepMs(700);
        }
        // 滚到底仍没找到 → 回顶部再试一轮
        round++;
        if (round < 2) scrollTop();
    }
    return null;
}

/** 等待连接结果，返回 'connected' | 'wrong_password' | 'timeout' */
function waitResult(ssid, cfg) {
    var timeoutMs = (cfg && cfg.timeoutSec > 0) ? cfg.timeoutSec * 1000 : RESULT_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        var ctl = checkControl(cfg);
        if (ctl) return ctl;
        sleepMs(800);
        // 错误反馈（MIUI 文案：密码错误/密码有误/请重新输入…）
        let err = textMatches(/(密码错误|密码不正确|密码有误|重新输入|不正确|连接超时|已断开)/).findOnce();
        if (err) {
            clog('错误提示: "' + (err.text() || err.desc()) + '"');
            // 关闭弹窗，避免影响下一次尝试
            let cancel = textMatches(/(取消|确定|知道了|好)/).clickable().findOnce();
            if (cancel) { cancel.click(); sleepMs(800); }
            return 'wrong_password';
        }
        // 成功反馈：MIUI 在网络条目 desc 中标注「已连接」（text 中不出现）
        if (descContains(ssid).descContains('已连接').findOnce()) {
            return 'connected';
        }
        // 兜底：部分系统在条目下方用 text 显示 已连接
        if (text('已连接').findOnce() && text(ssid).findOnce()) {
            return 'connected';
        }
    }
    return 'timeout';
}

/** 离开 WLAN 设置页并关闭会话 */
function leaveSettings() {
    for (let i = 0; i < 3; i++) {
        if (currentPackage() === 'com.android.settings') { back(); sleepMs(600); }
        else break;
    }
    session.active = false;
    session.ssid = '';
}

/** 关闭会话（供 engine 在结束/目标切换/异常时调用） */
function closeSession() {
    if (!session.active) return;
    clog('关闭会话: ' + session.ssid);
    leaveSettings();
}

/** 确保处于目标 SSID 的 WLAN 会话；同 SSID 复用，不同 SSID/未激活则重建 */
function ensureSession(ssid, cfg) {
    // 已激活且同 SSID 且仍在设置页 → 复用
    if (session.active && session.ssid === ssid && currentPackage() === 'com.android.settings') {
        return true;
    }
    // 否则重建会话
    if (session.active) { leaveSettings(); }
    openWifiSettings();
    if (currentPackage() !== 'com.android.settings') {
        clog('未能进入系统设置: ' + currentPackage());
        leaveSettings();
        return false;
    }
    session.active = true;
    session.ssid = ssid;
    clog('新建会话: ' + ssid);
    return true;
}

/** 关闭当前遗留的连接错误弹窗（不退出 WLAN 页） */
function dismissErrorDialog() {
    let err = textMatches(/(密码错误|密码不正确|密码有误|重新输入|不正确|连接超时|已断开)/).findOnce();
    if (err) {
        let cancel = textMatches(/(取消|确定|知道了|好)/).clickable().findOnce();
        if (cancel) { cancel.click(); sleepMs(700); return true; }
    }
    return false;
}

/**
 * 尝试用密码连接 SSID（由 engine.js 调用，已过合规校验）
 * 会话化：同一 SSID 的连续尝试复用 WLAN 页；密码错误后留在页内，下次直接重输。
 * @returns 'connected' | 'wrong_password' | 'timeout' | 'not_found' | 'saved' | 'skipped' | 'stopped'
 */
function attemptConnect(ssid, pwd, cfg) {
    try {
        if (!ensureSession(ssid, cfg)) return 'timeout';

        // 复用会话时，先看密码框是否还在（MIUI 可能弹窗未关）
        let box = className('android.widget.EditText').findOnce();
        let reused = false;
        if (box) {
            // 弹窗还在 → 清空重输
            box.setText('');
            sleepMs(200);
            reused = true;
        } else {
            // 弹窗已关 → 关闭可能的错误提示，重新定位并点击 SSID
            dismissErrorDialog();
            const entry = findSsidEntry(ssid, cfg);
            if (entry === 'skipped' || entry === 'stopped') return entry;
            if (!entry) {
                clog('列表中未找到 SSID: ' + ssid);
                closeSession();
                return 'not_found';
            }
            entry.click();
            // 轮询等待弹层出现
            for (let d = 0; d < 6; d++) {
                var ctl2 = checkControl(cfg);
                if (ctl2) return ctl2;
                sleepMs(700);
                box = className('android.widget.EditText').findOnce();
                if (box) break;
            }
        }

        if (box) {
            box.setText(pwd);
            sleepMs(500);
            let ok = textMatches(/(^(连接|确定|好)$)/).clickable().findOnce();
            if (!ok) ok = descMatches(/(连接|确定)/).clickable().findOnce();
            if (ok) { ok.click(); }
        } else {
            // 只有连接按钮/无密码框：已保存网络，跳过
            clog('已保存网络（无密码框），跳过: ' + ssid);
            let cancel = textMatches(/^(取消)$/).clickable().findOnce();
            if (cancel) { cancel.click(); sleepMs(500); }
            closeSession();
            return 'saved';
        }

        const result = waitResult(ssid, cfg);
        clog('attempt ' + ssid + ' → ' + result + (reused ? ' (复用弹窗)' : ''));

        // 失败后忘记网络（会话内操作，不退出）
        if (result === 'wrong_password' && cfg && cfg.forgetAfterFail) {
            let t = text(ssid).findOnce();
            if (t) {
                let node = t;
                for (let up = 0; up < 6 && node; up++) {
                    node = node.parent();
                    if (node && node.longClickable()) { node.longClick(); break; }
                }
                sleepMs(1000);
                let forget = textMatches(/(删除网络|忘记网络|取消保存)/).findOnce();
                if (forget) { forget.click(); sleepMs(700); }
            }
        }

        // 终止类结果：关闭会话；可重试结果（wrong_password/timeout）保留会话
        if (result === 'connected' || result === 'stopped' || result === 'skipped' || result === 'saved') {
            closeSession();
        }
        return result;
    } catch (e) {
        clog('attemptConnect 异常: ' + e);
        closeSession();
        return 'timeout';
    }
}

module.exports = { attemptConnect, closeSession };
