/**
 * wifi.js — 附近 WiFi 扫描（用于白名单选择）
 *
 * 三来源合并：当前连接(getConnectionInfo) + 历史保存(getConfiguredNetworks) + 被动扫描(getScanResults)。
 * 被动扫描在 Android 9+ 要求 ACCESS_FINE_LOCATION 权限 + 系统定位服务开启；
 * 前两个本地来源不依赖定位，扫描受限时仍能展示。只读取，不发起任何连接。
 */
importClass(android.net.wifi.WifiManager);

const store = require('./store.js');
function wlog(msg) {
    store.appendLine('wifi.log', new Date().toLocaleTimeString() + ' ' + msg);
}

/** 由 capabilities 字符串解析安全类型 */
function securityOf(capabilities) {
    const cap = capabilities || '';
    if (cap.indexOf('WPA3') >= 0) return 'WPA3';
    if (cap.indexOf('WEP') >= 0) return 'WEP';
    if (cap.indexOf('EAP') >= 0) return '企业';
    if (cap.indexOf('PSK') >= 0 || cap.indexOf('WPA') >= 0) return 'WPA2';
    return '开放';
}

/** SSID 去引号 + 过滤未知值 */
function cleanSsid(raw) {
    const s = String(raw || '').replace(/^"|"$/g, '').trim();
    return (!s || s === '<unknown ssid>') ? '' : s;
}

/** 来源优先级：current > saved > scan */
const SOURCE_RANK = { current: 3, saved: 2, scan: 1 };

/** 通用合并：小写 SSID 去重；有 level 优先、同名取最强；source 取优先级最高者 */
function putNetwork(best, item) {
    const key = item.ssid.toLowerCase();
    const prev = best[key];
    if (!prev) { best[key] = item; return; }
    if (item.level != null && (prev.level == null || item.level > prev.level)) {
        prev.level = item.level;
    }
    if (!prev.security && item.security) prev.security = item.security;
    if (SOURCE_RANK[item.source] > SOURCE_RANK[prev.source]) prev.source = item.source;
}

/** 来源1：当前连接的 WiFi（不依赖定位） */
function collectCurrent(wm, best) {
    try {
        const info = wm.getConnectionInfo();
        if (!info || info.getNetworkId() === -1) return 0;
        const ssid = cleanSsid(info.getSSID());
        if (!ssid) return 0;
        putNetwork(best, { ssid: ssid, level: info.getRssi(), security: '', source: 'current' });
        return 1;
    } catch (e) {
        wlog('scan: 当前连接读取失败 → ' + e);
        return 0;
    }
}

/** 来源2：历史保存网络（Android 10+ 第三方可能返回空或抛异常） */
function collectSaved(wm, best) {
    try {
        const list = wm.getConfiguredNetworks();
        if (!list) return 0;
        let n = 0;
        for (let i = 0; i < list.size(); i++) {
            const ssid = cleanSsid(list.get(i).SSID);
            if (!ssid) continue;
            putNetwork(best, { ssid: ssid, level: null, security: '', source: 'saved' });
            n++;
        }
        return n;
    } catch (e) {
        wlog('scan: 历史网络读取失败 → ' + e);
        return 0;
    }
}

/** 系统定位服务是否开启；无法判断时不阻断扫描（由结果兜底） */
function locationServiceOn() {
    try {
        importClass(android.location.LocationManager);
        const lm = context.getSystemService(context.LOCATION_SERVICE);
        return !!lm && lm.isLocationEnabled();
    } catch (e) {
        wlog('scan: 定位服务状态读取失败 → ' + e);
        return true;
    }
}

/** 读一次系统扫描快照；异常返回 null，不中断整体流程 */
function readResults(wm) {
    try { return wm.getScanResults(); } catch (e) {
        wlog('scan: getScanResults 异常 → ' + e);
        return null;
    }
}

/** 把一次被动扫描结果并入 best：标记 source=scan */
function mergeResults(best, results) {
    if (!results) return 0;
    let n = 0;
    try {
        const size = results.size();
        for (let i = 0; i < size; i++) {
            const r = results.get(i);
            const ssid = cleanSsid(r.SSID);
            if (!ssid) continue;                 // 跳过隐藏网络
            putNetwork(best, {
                ssid: ssid,
                level: r.level,                  // dBm，越大越强
                security: securityOf(String(r.capabilities || '')),
                source: 'scan',
            });
            n++;
        }
    } catch (e) {
        wlog('scan: 合并结果异常 → ' + e);
    }
    return n;
}

/** 收集当前连接 + 历史保存两个来源（不依赖定位），返回各自条数 */
function collectLocalSources(wm, best) {
    const cur = collectCurrent(wm, best);
    const saved = collectSaved(wm, best);
    wlog('scan: 当前连接 ' + cur + ' 条；历史保存 ' + saved + ' 条');
    return { cur: cur, saved: saved };
}

/** 统一收尾：有信号按强度降序在前、无信号置末；三来源均空时才回传降级原因 */
function finishScan(best, cb, localReason, throttledRounds) {
    const networks = Object.keys(best).map(function (k) { return best[k]; });
    networks.sort(function (a, b) {
        const av = (a.level == null) ? -999 : a.level;   // 无信号视为最弱，排末尾
        const bv = (b.level == null) ? -999 : b.level;
        return bv - av;
    });
    wlog('scan: 合并后 ' + networks.length + ' 个 SSID；节流轮次 ' + throttledRounds
        + '；本地来源降级 ' + (localReason || 'none'));

    if (!networks.length) {
        const reason = localReason || (throttledRounds >= 3 ? 'throttled' : 'empty');
        wlog('scan: 空列表，原因 ' + reason);
        cb([], reason);
        return;
    }
    // 有网络时仍把局部降级原因透传，供 UI 提示「当前连接/已保存可用，被动扫描受限」
    cb(networks, localReason);
}

/**
 * 扫描附近 WiFi（三来源合并：当前连接 + 历史保存 + 被动扫描）
 * @param cb function(networks, err)  networks: [{ssid, level, security, source}] 有信号的按强度降序在前，无信号的置末
 *                                   err: 局部降级原因码（no_permission/location_off/throttled/empty/error），三来源均空时非空
 */
function scan(cb) {
    try {
        wlog('scan: 开始');
        const wm = context.getSystemService(context.WIFI_SERVICE);
        const best = Object.create(null);

        // 来源1+2：当前连接与历史保存，不依赖定位权限，永远先纳入
        collectLocalSources(wm, best);

        // 来源3：被动扫描。权限/定位服务只影响这一路，不再一票否决整个列表。
        let localReason = '';
        if (context.checkSelfPermission('android.permission.ACCESS_FINE_LOCATION')
            !== android.content.pm.PackageManager.PERMISSION_GRANTED) {
            localReason = 'no_permission';
            wlog('scan: 缺少定位权限，跳过被动扫描');
        } else if (!locationServiceOn()) {
            localReason = 'location_off';
            wlog('scan: 系统定位服务关闭，跳过被动扫描');
        }

        if (localReason) {
            finishScan(best, cb, localReason, 0);
            return;
        }
        wlog('scan: 定位权限与服务检查通过');

        // 基线：先同步读一次系统快照，即便 startScan 被节流也有旧结果兜底
        const baselineCount = mergeResults(best, readResults(wm));
        wlog('scan: 基线快照 ' + baselineCount + ' 条');

        // 优先监听系统扫描完成广播，拿到真实完成时刻再取结果；
        // AutoX.js 不支持时回退到 startScan + 固定等待的旧写法。
        let receiver = null;
        let gotBroadcast = false;
        try {
            importClass(android.content.BroadcastReceiver);
            importClass(android.content.IntentFilter);
            receiver = new JavaAdapter(android.content.BroadcastReceiver, {
                onReceive: function (c, intent) { gotBroadcast = true; }
            });
            context.registerReceiver(receiver,
                new IntentFilter(WifiManager.SCAN_RESULTS_AVAILABLE_ACTION));
            wlog('scan: 扫描完成广播已注册');
        } catch (e) {
            wlog('scan: 广播注册失败，回退轮询 → ' + e);
            receiver = null;
        }

        // 轮次与等待加大：不同 AP 在不同扫描时刻才出现，留出真实间隔让系统发现更多 SSID
        const ROUNDS = 6;
        const ROUND_MIN_WAIT_MS = 2500;   // 每轮至少等待，避免广播一到就立刻收尾
        const ROUND_TIMEOUT_MS = 5000;    // 广播等待上限（到达即走，但不早于最小等待）
        let throttledRounds = 0;
        try {
            // 多轮触发 + 取并集，避免 startScan 被节流时只用旧快照
            for (let round = 0; round < ROUNDS; round++) {
                let ok = false;
                try {
                    ok = wm.startScan();
                    wlog('scan round ' + round + ': startScan=' + ok);
                } catch (e) {
                    wlog('scan round ' + round + ': startScan 异常 → ' + e);
                }
                if (!ok) throttledRounds++;

                const started = Date.now();
                if (receiver) {
                    gotBroadcast = false;
                    const deadline = started + ROUND_TIMEOUT_MS;
                    // 广播到达且满足最小等待才提前结束，给系统扫到更多 AP 的时间
                    while (Date.now() < deadline) {
                        if (gotBroadcast && (Date.now() - started) >= ROUND_MIN_WAIT_MS) break;
                        sleep(150);
                    }
                    wlog('scan round ' + round + ': 广播=' + gotBroadcast);
                } else {
                    sleep(ROUND_MIN_WAIT_MS);
                }

                const before = Object.keys(best).length;
                const count = mergeResults(best, readResults(wm));
                const after = Object.keys(best).length;
                wlog('scan round ' + round + ': 合并 ' + count + ' 条，新增 '
                    + (after - before) + ' 个 SSID（累计 ' + after + '）');
            }
        } finally {
            if (receiver) {
                try { context.unregisterReceiver(receiver); }
                catch (e) { wlog('scan: 广播注销异常 → ' + e); }
            }
        }

        finishScan(best, cb, '', throttledRounds);
    } catch (e) {
        wlog('scan: 异常 → ' + e);
        cb([], 'error');
    }
}

module.exports = { scan };
