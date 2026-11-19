/**
 * connect.js — 真实连接引擎（无障碍自动化系统 WLAN 设置）
 *
 * 仅由 engine.js 对 compliance 白名单内的网络调用（授权声明制，见总纲）。
 * 流程：打开 WLAN 设置 → 滚动定位目标 SSID → 点击 → 输入密码 → 连接 → 判定结果 → 返回
 * 结果：'connected' | 'wrong_password' | 'timeout' | 'not_found'
 *
 * 选择器按 MIUI marble / Android 15 实测标定（probe-ui.js 转储）。
 */
const W = require('./store.js'); // 复用日志落盘

const TAG = 'connect';
const FIND_MAX_SCREENS = 8;   // SSID 列表最多向下滚几屏
const RESULT_TIMEOUT_MS = 20000; // 连接结果等待上限

function clog(msg) {
    W.appendLine('connect.log', new Date().toLocaleTimeString() + ' ' + msg);
}

function sleepMs(ms) { sleep(ms); }

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

/** 在 WLAN 列表中查找目标 SSID（含滚动），返回可点击的列表项节点或 null */
function findSsidEntry(ssid) {
    scrollTop();
    for (let screen = 0; screen < FIND_MAX_SCREENS; screen++) {
        // 优先找 SSID 文本节点，再向上找可点击父项
        let t = text(ssid).findOnce();
        if (t) {
            let node = t;
            for (let up = 0; up < 6 && node; up++) {
                if (node.clickable()) return node;
                node = node.parent();
            }
            // 找不到可点击父项就直接点文本
            return t;
        }
        // 当前屏没有 → 向下滚一屏
        swipe(540, 2000, 540, 600, 300);
        sleepMs(900);
    }
    return null;
}

/** 等待连接结果，返回 'connected' | 'wrong_password' | 'timeout' */
function waitResult(ssid, cfg) {
    const deadline = Date.now() + RESULT_TIMEOUT_MS;
    while (Date.now() < deadline) {
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

/** 尝试结束后离开 WLAN 设置页 */
function leaveSettings() {
    for (let i = 0; i < 3; i++) {
        if (currentPackage() === 'com.android.settings') { back(); sleepMs(600); }
        else break;
    }
}

/**
 * 尝试用密码连接 SSID（由 engine.js 调用，已过合规校验）
 * @returns 'connected' | 'wrong_password' | 'timeout' | 'not_found'
 */
function attemptConnect(ssid, pwd, cfg) {
    try {
        openWifiSettings();
        if (currentPackage() !== 'com.android.settings') {
            clog('未能进入系统设置: ' + currentPackage());
            leaveSettings();
            return 'timeout';
        }
        const entry = findSsidEntry(ssid);
        if (!entry) {
            clog('列表中未找到 SSID: ' + ssid);
            leaveSettings();
            return 'not_found';
        }
        entry.click();
        // 轮询等待弹层出现（MIUI 弹窗渲染需要 2-3 秒）
        let box = null, connBtn = null;
        for (let d = 0; d < 6; d++) {
            sleepMs(800);
            box = className('android.widget.EditText').findOnce();
            connBtn = textMatches(/^(连接|确定)$/).clickable().findOnce();
            if (box || connBtn) break;
        }
        if (box) {
            box.setText(pwd);
            sleepMs(600);
            let ok = textMatches(/(^(连接|确定|好)$)/).clickable().findOnce();
            if (!ok) ok = descMatches(/(连接|确定)/).clickable().findOnce();
            if (ok) { ok.click(); }
        } else if (connBtn) {
            // 已保存网络：密码系统已知，跳过尝试
            clog('已保存网络（无密码框，弹连接确认），跳过: ' + ssid);
            let cancel = textMatches(/^(取消)$/).clickable().findOnce();
            if (cancel) { cancel.click(); sleepMs(600); }
            leaveSettings();
            return 'saved';
        } else {
            clog('无弹层（可能直接开始连接）');
        }

        const result = waitResult(ssid, cfg);
        clog('attempt ' + ssid + ' → ' + result);
        // 失败后是否忘记网络（可选配置）
        if (result === 'wrong_password' && cfg && cfg.forgetAfterFail) {
            let t = text(ssid).findOnce();
            if (t) {
                let node = t;
                for (let up = 0; up < 6 && node; up++) {
                    node = node.parent();
                    if (node && node.longClickable()) { node.longClick(); break; }
                }
                sleepMs(1200);
                let forget = textMatches(/(删除网络|忘记网络|取消保存)/).findOnce();
                if (forget) { forget.click(); sleepMs(800); }
            }
        }
        leaveSettings();
        return result;
    } catch (e) {
        clog('attemptConnect 异常: ' + e);
        try { leaveSettings(); } catch (e2) {}
        return 'timeout';
    }
}

module.exports = { attemptConnect };
