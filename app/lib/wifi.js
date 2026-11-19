/**
 * wifi.js — 附近 WiFi 扫描（用于白名单选择）
 *
 * 通过 WifiManager.getScanResults 获取系统扫描结果。
 * Android 9+ 要求：App 有 ACCESS_FINE_LOCATION 权限 + 系统定位服务开启。
 * 这里只做被动扫描，不发起任何连接。
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

/**
 * 扫描附近 WiFi
 * @param cb function(networks, err)  networks: [{ssid, level, security}] 按信号强度降序
 */
function scan(cb) {
    try {
        wlog('scan: 开始');
        // 只检查不请求：requestPermissions 在部分版本会中断当前脚本（实测致命）。
        // 权限缺失时由 UI 提示用户去系统设置授予。
        if (context.checkSelfPermission('android.permission.ACCESS_FINE_LOCATION')
            !== android.content.pm.PackageManager.PERMISSION_GRANTED) {
            wlog('scan: 缺少定位权限');
            cb([], '缺少「位置信息」权限：请在系统设置 → 应用 → Autox.js → 权限中授予后重试');
            return;
        }
        wlog('scan: 权限检查通过');

        const wm = context.getSystemService(context.WIFI_SERVICE);
        // 系统对 startScan 有节流（单次结果可能是旧快照），
        // 3 轮触发 + 取并集、同名 SSID 保留最强信号
        const best = Object.create(null);
        for (let round = 0; round < 5; round++) {
            try {
                const ok = wm.startScan();
                wlog('scan round ' + round + ': startScan=' + ok);
            } catch (e) {
                wlog('scan round ' + round + ': startScan 异常 → ' + e);
            }
            sleep(2500);
            let results;
            try { results = wm.getScanResults(); } catch (e) {
                wlog('scan round ' + round + ': getScanResults 异常 → ' + e);
                continue;
            }
            wlog('scan round ' + round + ': getScanResults → ' + results.size() + ' 条');
            for (let i = 0; i < results.size(); i++) {
                const r = results.get(i);
                const ssid = r.SSID ? String(r.SSID).trim() : '';
                if (!ssid) continue;             // 跳过隐藏网络
                if (!best[ssid] || r.level > best[ssid].level) {
                    best[ssid] = {
                        ssid: ssid,
                        level: r.level,          // dBm，越大越强
                        security: securityOf(String(r.capabilities || '')),
                    };
                }
            }
        }
        // 信号强度降序：越强越靠前
        const networks = Object.keys(best).map(function (k) { return best[k]; });
        networks.sort(function (a, b) { return b.level - a.level; });
        wlog('scan: 合并后 ' + networks.length + ' 个 SSID（按信号降序），回调中');
        cb(networks);
    } catch (e) {
        wlog('scan: 异常 → ' + e);
        cb([], String(e));
    }
}

module.exports = { scan };
