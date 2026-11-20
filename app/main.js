/**
 * main.js — 项目入口
 *
 * 职责：
 *   1. 以 WebView 宿主方式加载 web/index.html（全部 UI）
 *   2. 命令轮询桥：网页把命令放进 window.__cmdQueue，
 *      原生侧定时取走并分发（无需 dex 的轻量桥接方案）
 *   3. 把引擎事件通过 evaluateJavascript 推回网页
 *
 * 模块划分：lib/compliance（合规）→ lib/dict（字典）→ lib/engine（循环）
 */
'ui';

const compliance = require('./lib/compliance.js');
const engine = require('./lib/engine.js');
const store = require('./lib/store.js');
const wifi = require('./lib/wifi.js');
const panel = require('./lib/panel.js');

/** 桥接诊断日志（临时，验证通过后可移除） */
function bridgeLog(msg) {
    store.appendLine('bridge.log', new Date().toLocaleTimeString() + ' ' + msg);
}

ui.layout(
    <vertical>
        <webview id="web" w="*" h="*" />
    </vertical>
);

/* 启动清理：强制结束上次残留的 main.js 实例，确保本次是唯一存活实例。
   旧逻辑是「发现重复就 exit 自己」，会导致 Intent 重拉时新实例退出、旧僵尸继续占屏。 */
try {
    const storeGuard = require('./lib/store.js');
    const myId = String(engines.myEngine().getId());
    let killedOld = 0, seen = [];
    engines.all().forEach(function (e) {
        const src = String(e.getSource && e.getSource() || '');
        const id = String(e.getId && e.getId() || '');
        seen.push(id + '|' + src.slice(0, 40));
        // 僵尸实例的 id 可能为空，用实例对象的 forceStop 而非按 id 停止
        if (src.indexOf('main.js') >= 0 && id !== myId) {
            try { e.forceStop(); killedOld++; } catch (eStop) {}
        }
    });
    storeGuard.appendLine('bridge.log', 'guard: my=' + myId + ' killedOld=' + killedOld
        + ' all=[' + seen.join('; ') + ']');
    if (killedOld) sleep(800); // 等旧实例 WebView 完全释放，避免两个 WebView 叠加
} catch (eGuard) {
    console.error('[main] 启动清理异常: ' + eGuard);
}

const WEB_URL = 'file://' + files.cwd() + '/web/index.html';
ui.web.getSettings().setJavaScriptEnabled(true);
ui.web.getSettings().setDomStorageEnabled(true);
ui.web.getSettings().setAllowFileAccess(true);
ui.web.loadUrl(WEB_URL);

/* 系统返回键：优先走网页内返回（弹层 → 上一页），网页栈空才退出。
   AutoX 不同版本事件名不同（back / back_press），双注册 + 300ms 防抖 */
let lastBackAt = 0;
function onBackKey(e) {
    const now = Date.now();
    if (now - lastBackAt < 300) return;
    lastBackAt = now;
    // 消费默认返回行为（AutoX 检查 event.consumed），是否真正退出由网页返回栈决定
    try {
        if (e && 'consumed' in e) e.consumed = true;
        if (e && typeof e.consume === 'function') e.consume();
    } catch (eConsume) {}
    ui.run(function () {
        try {
            ui.web.evaluateJavascript(
                "(function(){return (window.__webBack&&__webBack())?'1':'0';})()",
                function (result) {
                    // evaluateJavascript 会给字符串结果再包一层引号
                    const r = String(result == null ? '' : result);
                    bridgeLog('backkey: __webBack → ' + r);
                    if (r.indexOf('1') < 0) ui.finish();
                }
            );
        } catch (e) {
            ui.finish();
        }
    });
}
['back_pressed', 'back_press', 'back'].forEach(function (name) {
    ui.emitter.on(name, onBackKey);
});

/* ---------- 原生 → 网页：事件推送 ---------- */
function pushEvent(name, data) {
    ui.run(function () {
        try {
            const js = 'window.__onNativeEvent && __onNativeEvent('
                + JSON.stringify(name) + ',' + JSON.stringify(data || null) + ')';
            ui.web.evaluateJavascript(js, function (result) {
                if (result === null || result === undefined) {
                    bridgeLog('pushEvent[' + name + '] 回调为空（页面可能未就绪）');
                }
            });
        } catch (e) {
            bridgeLog('pushEvent[' + name + '] 失败: ' + e);
        }
    });
}

/* ---------- 网页 → 原生：命令分发 ---------- */
/** 字典列表（dicts/ 目录 + dictmeta.json 元数据） */
function sanitizeDictName(name) {
    return String(name || '').replace(/[\\/\\:*?"<>|]/g, '').trim();
}
function dictsList() {
    const meta = store.load('dictmeta.json', {});
    const dir = files.cwd() + '/dicts/';
    const list = [];
    if (files.exists(dir)) {
        files.listDir(dir, function (n) { return n.endsWith('.txt'); }).forEach(function (n) {
            const name = n.replace(/\.txt$/, '');
            let count = 0;
            try {
                count = files.read(dir + n).split(/\r?\n/)
                    .map(function (s) { return s.trim(); })
                    .filter(function (s) { return s.length > 0; }).length;
            } catch (e) {}
            const m = meta[name] || {};
            list.push({ name: name, count: count, enabled: m.enabled !== false, desc: m.desc || '' });
        });
    }
    return list;
}
function dictMeta() {
    return store.load('dictmeta.json', {});
}
function saveDictMeta(meta) {
    store.save('dictmeta.json', meta);
}
function dictPath(name) {
    return files.cwd() + '/dicts/' + sanitizeDictName(name) + '.txt';
}
function readDictEntries(name) {
    const p = dictPath(name);
    if (!files.exists(p)) return [];
    return files.read(p).replace(/\r\n/g, '\n').split('\n')
        .map(function (s) { return s.trim(); })
        .filter(function (s) { return s.length > 0; });
}
function writeDictEntries(name, entries) {
    files.write(dictPath(name), (entries || []).join('\n') + ((entries && entries.length) ? '\n' : ''));
}
function nowStr() {
    const d = new Date();
    const p2 = function (n) { return String(n).padStart(2, '0'); };
    return (d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate())
        + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()));
}
function pushHistory() {
    pushEvent('history_data', { list: store.load('history.json', []) });
}
function addHistory(targets) {
    const h = store.load('history.json', []);
    const id = String(Date.now()) + '-' + Math.floor(Math.random() * 1000);
    h.unshift({ id: id, time: nowStr(), targets: targets, status: '运行中', hits: [] });
    store.save('history.json', h.slice(0, 20));
    pushHistory();
    return id;
}
function findRunning(h, id) {
    // 优先按 id 精确定位；旧记录无 id 时兼容回退到首条运行中
    let rec = id ? h.find(function (x) { return x.id === id; }) : null;
    if (!rec) rec = h.find(function (x) { return x.status === '运行中'; });
    return rec;
}
function finishHistory(id, success, hits, reason) {
    const h = store.load('history.json', []);
    const rec = findRunning(h, id);
    if (rec) {
        rec.status = success ? '命中' : (reason || '未命中');
        rec.hits = hits || [];
        store.save('history.json', h.slice(0, 20));
        pushHistory();
    }
}
function handleCommand(cmd, payload) {
    if (cmd === 'start_task') {
        // UI 侧白名单同步进合规层（UI 编辑以本次任务携带为准）
        if (payload && Array.isArray(payload.whitelist) && payload.whitelist.length > 0) {
            compliance.saveConfig({ whitelist: payload.whitelist });
            compliance.audit('WHITELIST_UPDATE', payload.whitelist.join(', '));
        }
        compliance.recordAuthConfirmation();
        // 已有任务在跑时不新建历史（否则会被 engine 拒绝后留下一条永久「运行中」的错位记录）
        if (engine.isRunning()) {
            toast('已有任务在运行，请等待结束或先停止');
            pushEvent('task_state', { state: 'rejected', reason: '已有任务在运行' });
            return;
        }
        const taskId = addHistory((payload.targets && payload.targets.length) ? payload.targets : [payload.ssid]);
        // 屏幕常亮仅在任务期间生效（偏好由设置页携带）
        const wantKeepAwake = !!(payload && payload.keepAwake);
        if (wantKeepAwake) { try { device.keepScreenOn(0); } catch (e) {} }
        // 悬浮窗面板：任务运行期间唯一的暂停/停止入口（屏幕会被 WLAN 设置页占用）
        const pvTargets = (payload && payload.targets && payload.targets.length)
            ? payload.targets : [payload && payload.ssid];
        panel.create('目标 ' + (pvTargets.length > 1
            ? pvTargets[0] + ' 等' + pvTargets.length + '个' : pvTargets[0]), {
            onPause: function () {
                if (engine.isPaused()) { engine.resume(); } else { engine.pause(); }
                panel.setPaused(engine.isPaused());
            },
            onStop: function () { engine.stop(); },
        });
        // 引擎含阻塞 UI 自动化操作，必须在独立线程执行（ui 线程禁止 sleep）
        threads.start(function () {
            engine.start(payload, {
                onLog: function (text, cls) {
                    panel.update(text.length > 24 ? text.slice(0, 24) : text);
                    store.appendLine('runtime.log', new Date().toLocaleTimeString() + ' ' + text);
                    pushEvent('progress', { text: text, cls: cls || '' });
                },
                onProgress: function (p) {
                    if (p.tried != null && p.total != null) {
                        panel.update((p.target || (payload && payload.ssid) || '') + ' · ' + p.tried + '/' + p.total);
                    }
                    if (p.currentPwd != null) panel.setPwd(p.currentPwd);
                    pushEvent('progress', p);
                },
                onHit: function (ssid, pwd) {
                    const h = store.load('history.json', []);
                    const rec = findRunning(h, taskId);
                    if (rec && rec.hits.indexOf(ssid) < 0) rec.hits.push(ssid);
                    store.save('history.json', h.slice(0, 20));
                    panel.setPwd('✓ ' + (pwd || '')); // 命中：悬浮窗显示命中密码
                    pushEvent('task_hit', { ssid: ssid, password: pwd || '' });
                },
                onDone: function (success, reason) {
                    if (wantKeepAwake) { try { device.cancelKeepingAwake(); } catch (e) {} }
                    panel.close();
                    const h = store.load('history.json', []);
                    const rec = findRunning(h, taskId);
                    finishHistory(taskId, success, (rec && rec.hits) || [], reason);
                    toast('任务' + (success ? '成功' : '结束') + (reason ? '：' + reason : ''));
                    pushEvent('task_done', { success: success, reason: reason });
                },
            });
        });
    } else if (cmd === 'stop_task') {
        if (engine.isRunning()) pushEvent('task_state', { state: 'stopping' });
        engine.stop();
    } else if (cmd === 'scan_wifi') {
        // 扫描含 sleep 等待，放独立线程避免冻结 UI
        threads.start(function () {
            wifi.scan(function (networks, err) {
                pushEvent('wifi_scan_result', { networks: networks || [], reason: err || '' });
            });
        });
    } else if (cmd === 'import_whitelist_file') {
        // 白名单文件导入：默认查找 /sdcard/Download/whitelist.txt 与项目根目录 whitelist.txt
        threads.start(function () {
            const paths = [
                (payload && payload.path) || '',
                '/sdcard/Download/whitelist.txt',
                files.cwd() + '/whitelist.txt',
            ].filter(Boolean);
            let list = [], reason = '';
            for (let i = 0; i < paths.length; i++) {
                try {
                    if (files.exists(paths[i]) && files.isFile(paths[i])) {
                        list = files.read(paths[i]).split(/\r?\n/)
                            .map(function (s) { return s.trim(); })
                            .filter(function (s) { return s.length > 0; });
                        reason = '从 ' + paths[i] + ' 读到 ' + list.length + ' 条';
                        compliance.saveConfig({ whitelist: list });
                        compliance.audit('WHITELIST_UPDATE', '文件导入: ' + list.join(', '));
                        break;
                    }
                } catch (e) { reason = String(e); }
            }
            if (!list.length && !reason) {
                reason = '未找到 whitelist.txt（可放 /sdcard/Download/ 或项目根目录，一行一个 SSID）';
            }
            pushEvent('whitelist_imported', { list: list, reason: reason });
        });
    } else if (cmd === 'get_history') {
        pushHistory();
    } else if (cmd === 'get_wifi_status') {
        threads.start(function () {
            let ssid = '', rssi = null, connected = false;
            try {
                importClass(android.net.wifi.WifiManager);
                const wm = context.getSystemService(context.WIFI_SERVICE);
                const info = wm.getConnectionInfo();
                const raw = String(info.getSSID() || '');
                connected = info.getNetworkId() !== -1;
                ssid = raw.replace(/^"|"$/g, '');
                if (ssid === '<unknown ssid>') ssid = '';
                rssi = info.getRssi();
            } catch (e) {}
            pushEvent('wifi_status', { ssid: connected ? ssid : '', connected: connected, rssi: rssi });
        });
    } else if (cmd === 'skip_task') {
        engine.skip();
        pushEvent('task_state', { state: 'skipping' });
    } else if (cmd === 'get_perms') {
        threads.start(function () {
            let acc = false, overlay = false, batt = false;
            try { acc = !!(auto && auto.service); } catch (e) {}
            try {
                importClass(android.provider.Settings);
                overlay = Settings.canDrawOverlays(context);
            } catch (e) {}
            try {
                importClass(android.os.PowerManager);
                const pm = context.getSystemService(context.POWER_SERVICE);
                batt = pm.isIgnoringBatteryOptimizations(context.getPackageName());
            } catch (e) {}
            pushEvent('perms_data', { acc: acc, overlay: overlay, batt: batt });
        });
    } else if (cmd === 'open_acc_settings') {
        app.startActivity({ action: 'android.settings.ACCESSIBILITY_SETTINGS' });
    } else if (cmd === 'open_overlay_settings') {
        app.startActivity({
            action: 'android.settings.ACTION_MANAGE_OVERLAY_PERMISSION',
            data: 'package:org.autojs.autoxjs.v7'
        });
    } else if (cmd === 'open_batt_opt') {
        app.startActivity({ action: 'android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS' });
    } else if (cmd === 'get_device_status') {
        threads.start(function () {
            let battery = -1, temp = -1, charging = false, wifiOn = false;
            try {
                importClass(android.content.Intent);
                const bm = context.registerReceiver(null,
                    new android.content.IntentFilter(android.content.Intent.ACTION_BATTERY_CHANGED));
                if (bm) {
                    const level = bm.getIntExtra('level', -1);
                    const scale = bm.getIntExtra('scale', 100);
                    battery = scale > 0 ? Math.round(level * 100 / scale) : -1;
                    temp = bm.getIntExtra('temperature', -1) / 10; // 十分之一摄氏度
                    charging = bm.getIntExtra('plugged', 0) > 0;
                }
            } catch (e) {}
            try {
                const wm = context.getSystemService(context.WIFI_SERVICE);
                wifiOn = !!(wm && wm.isWifiEnabled());
            } catch (e) {}
            pushEvent('device_status', { battery: battery, temp: temp, charging: charging, wifiOn: wifiOn });
        });
    } else if (cmd === 'set_keep_awake') {
        try {
            if (payload && payload.on) { device.keepScreenOn(0); toast('屏幕常亮已开启'); }
            else { device.cancelKeepingAwake(); toast('屏幕常亮已关闭'); }
        } catch (e) { toast('设置屏幕常亮失败：' + e); }
    } else if (cmd === 'open_wifi_settings') {
        try { app.startActivity({ action: android.provider.Settings.ACTION_WIFI_SETTINGS }); }
        catch (e) { toast('无法打开 Wi-Fi 设置'); }
    } else if (cmd === 'backup_data') {
        threads.start(function () {
            try {
                const dir = files.cwd() + '/data/';
                const dump = { version: 1, time: nowStr(), config: null, dictmeta: null, dicts: {} };
                if (files.exists(dir + 'config.json')) dump.config = JSON.parse(files.read(dir + 'config.json'));
                if (files.exists(dir + 'dictmeta.json')) dump.dictmeta = JSON.parse(files.read(dir + 'dictmeta.json'));
                const dd = files.cwd() + '/dicts/';
                if (files.exists(dd)) {
                    const list = files.listDir(dd);
                    list.forEach(function (name) {
                        if (name.toLowerCase().endsWith('.txt')) dump.dicts[name] = files.read(dd + name);
                    });
                }
                const dest = '/sdcard/Download/wifipoller-backup-' + Date.now() + '.json';
                files.write(dest, JSON.stringify(dump, null, 2));
                pushEvent('backup_result', { ok: true, path: dest, reason: '已导出 ' + Object.keys(dump.dicts).length + ' 个字典' });
            } catch (e) {
                pushEvent('backup_result', { ok: false, reason: String(e) });
            }
        });
    } else if (cmd === 'restore_data') {
        threads.start(function () {
            try {
                const path = (payload && payload.path) ? String(payload.path).trim() : '';
                if (!path || !files.exists(path)) { pushEvent('restore_result', { ok: false, reason: '文件不存在' }); return; }
                const dump = JSON.parse(files.read(path));
                if (!dump || dump.version !== 1) { pushEvent('restore_result', { ok: false, reason: '备份格式不兼容' }); return; }
                const dir = files.cwd() + '/data/';
                if (dump.config) files.write(dir + 'config.json', JSON.stringify(dump.config, null, 2));
                if (dump.dictmeta) files.write(dir + 'dictmeta.json', JSON.stringify(dump.dictmeta, null, 2));
                const dd = files.cwd() + '/dicts/';
                Object.keys(dump.dicts || {}).forEach(function (name) { files.write(dd + name, dump.dicts[name]); });
                pushEvent('restore_result', { ok: true, reason: '已恢复 ' + Object.keys(dump.dicts || {}).length + ' 个字典，请重启脚本生效' });
            } catch (e) {
                pushEvent('restore_result', { ok: false, reason: String(e) });
            }
        });
    } else if (cmd === 'reset_panel_pos') {
        panel.resetPos();
        toast('悬浮窗位置已重置');
    } else if (cmd === 'pause_task') {
        engine.pause();
        panel.setPaused(true);
        pushEvent('task_state', { state: 'paused' });
    } else if (cmd === 'resume_task') {
        engine.resume();
        panel.setPaused(false);
        pushEvent('task_state', { state: 'running' });
    } else if (cmd === 'get_whitelist') {
        // 页面就绪后主动拉取（避免 init 推送与页面加载竞态）
        pushEvent('init_whitelist', { list: compliance.config().whitelist });
    } else if (cmd === 'set_whitelist') {
        if (payload && Array.isArray(payload.list)) {
            compliance.saveConfig({ whitelist: payload.list });
            compliance.audit('WHITELIST_UPDATE', payload.list.join(', '));
        }
    } else if (cmd === 'get_dicts') {
        pushEvent('dicts_data', { list: dictsList() });
    } else if (cmd === 'get_dict_entries') {
        var geName = sanitizeDictName(payload && payload.name);
        var geMeta = dictMeta()[geName] || {};
        pushEvent('dict_entries', {
            name: geName,
            entries: readDictEntries(geName),
            desc: geMeta.desc || '',
            enabled: geMeta.enabled !== false,
            rules: geMeta.rules || {}
        });
    } else if (cmd === 'create_dict') {
        var crName = sanitizeDictName(payload && payload.name);
        if (crName) {
            var crMeta = dictMeta();
            if (!files.exists(dictPath(crName))) writeDictEntries(crName, []);
            if (!crMeta[crName]) crMeta[crName] = { enabled: true, desc: '', rules: {} };
            saveDictMeta(crMeta);
            compliance.audit('DICT_CREATE', 'name=' + crName);
        }
        pushEvent('dicts_data', { list: dictsList() });
    } else if (cmd === 'save_dict') {
        var svName = sanitizeDictName(payload && payload.name);
        if (svName) {
            var svEntries = Array.isArray(payload.content)
                ? payload.content
                : String(payload.content || '').split(/\r?\n/)
                    .map(function (s) { return s.trim(); })
                    .filter(function (s) { return s.length > 0; });
            writeDictEntries(svName, svEntries);
            var svMeta = dictMeta();
            var svItem = svMeta[svName] || {};
            if (payload.desc != null) svItem.desc = String(payload.desc);
            if (payload.enabled != null) svItem.enabled = !!payload.enabled;
            if (payload.rules) svItem.rules = payload.rules;
            svMeta[svName] = svItem;
            saveDictMeta(svMeta);
            compliance.audit('DICT_SAVE', 'name=' + svName + ' entries=' + svEntries.length);
        }
        pushEvent('dicts_data', { list: dictsList() });
    } else if (cmd === 'delete_dict') {
        var dlName = sanitizeDictName(payload && payload.name);
        if (dlName) {
            try { files.remove(dictPath(dlName)); } catch (e) {}
            var dlMeta = dictMeta();
            delete dlMeta[dlName];
            saveDictMeta(dlMeta);
            compliance.audit('DICT_DELETE', 'name=' + dlName);
        }
        pushEvent('dicts_data', { list: dictsList() });
    } else if (cmd === 'set_dict_enabled') {
        var enName = sanitizeDictName(payload && payload.name);
        if (enName) {
            var enMeta = dictMeta();
            var enItem = enMeta[enName] || {};
            enItem.enabled = !!(payload && payload.enabled);
            enMeta[enName] = enItem;
            saveDictMeta(enMeta);
            compliance.audit('DICT_TOGGLE', 'name=' + enName + ' enabled=' + enItem.enabled);
        }
        pushEvent('dicts_data', { list: dictsList() });
    } else if (cmd === 'list_download_txt') {
        var ldDir = (payload && payload.path) ? String(payload.path) : '/sdcard/Download/';
        if (!ldDir.endsWith('/')) ldDir += '/';
        var ldList = [];
        if (files.exists(ldDir)) {
            try {
                files.listDir(ldDir, function (n) { return n.toLowerCase().endsWith('.txt'); })
                    .forEach(function (n) { ldList.push(ldDir + n); }); // 返回完整路径
            } catch (e) { bridgeLog('列目录失败: ' + ldDir + ' ' + e); }
        }
        var ldShortcuts = ['/sdcard/Download/', files.cwd() + '/dicts/', '/sdcard/Documents/'];
        pushEvent('download_txt_list', { files: ldList, path: ldDir, shortcuts: ldShortcuts });
    } else if (cmd === 'exit_app') {
        // 首页左上角返回：网页无法自行结束进程，交原生在 UI 线程退出
        bridgeLog('exit_app: 网页请求退出应用');
        try { ui.run(function () { ui.finish(); }); } catch (eExit) { ui.finish(); }
    } else if (cmd === 'import_from_download') {
        var imPath = (payload && payload.path) ? String(payload.path) : '';
        if (imPath && imPath.toLowerCase().endsWith('.txt')) {
            if (files.exists(imPath)) {
                var imBase = imPath.split('/').pop();
                var imDictName = sanitizeDictName(imBase.replace(/\.txt$/i, ''));
                var imEntries = files.read(imPath).split(/\r?\n/)
                    .map(function (s) { return s.trim(); })
                    .filter(function (s) { return s.length > 0; });
                writeDictEntries(imDictName, imEntries);
                var imMeta = dictMeta();
                if (!imMeta[imDictName]) imMeta[imDictName] = { enabled: true, desc: '', rules: {} };
                saveDictMeta(imMeta);
                compliance.audit('DICT_IMPORT', 'name=' + imDictName + ' path=' + imPath + ' entries=' + imEntries.length);
                toast('已导入：' + imDictName + '（' + imEntries.length + ' 条）');
                pushEvent('dicts_data', { list: dictsList() });
            } else {
                toast('文件不存在：' + imPath);
            }
        } else {
            toast('请选择 txt 文件');
        }
    }
}

/* 命令轮询：每 600ms 取一次网页命令队列 */
setInterval(function () {
    /* 运行期自检开关：data/selftest.flag 存在则自动提交一次任务（免重启复测） */
    try {
        const stopFlag = files.cwd() + '/data/stop.flag';
        if (files.exists(stopFlag)) {
            files.remove(stopFlag);
            bridgeLog('stop(flag): 请求停止当前任务');
            engine.stop();
        }
        const flag = files.cwd() + '/data/selftest.flag';
        if (files.exists(flag)) {
            files.remove(flag);
            const ssid = (compliance.config().whitelist[0] || '').trim();
            bridgeLog('selftest(flag): 提交任务 ssid=' + ssid);
            handleCommand('start_task', { ssid: ssid, maxAttempts: 50, intervalSec: 3 });
        }
    } catch (eSelftest) {
        bridgeLog('selftest 检查异常: ' + eSelftest);
    }
    let pvTimer = null;
    /* 面板预览开关：data/preview.flag 存在则显示悬浮窗（不启动任务） */
    try {
        const pvFlag = files.cwd() + '/data/preview.flag';
        if (files.exists(pvFlag)) {
            files.remove(pvFlag);
            let pvN = 0, pvPaused = false;
            panel.create('悬浮窗预览', {
                onPause: function () { pvPaused = !pvPaused; panel.setPaused(pvPaused); },
                onStop: function () { clearInterval(pvTimer); panel.close(); },
            });
            bridgeLog('preview: 面板已创建');
            pvTimer = setInterval(function () {
                pvN++;
                panel.update('预览进度 ' + pvN + '/50');
                if (pvN >= 50) { clearInterval(pvTimer); panel.close(); }
            }, 1000);
        }
    } catch (ePreview) {
        bridgeLog('preview 检查异常: ' + ePreview);
    }
    ui.run(function () {
        try {
            ui.web.evaluateJavascript(
                '(function(){var q=window.__cmdQueue||[];window.__cmdQueue=[];'
                + 'return JSON.stringify(q);})()',
                function (result) {
                    if (result === null || result === undefined) {
                        bridgeLog('poll: result 为空（页面未就绪或回调异常）');
                        return;
                    }
                    let cmds;
                    try {
                        cmds = JSON.parse(result);
                        // evaluateJavascript 会把字符串结果再包一层 JSON 引号
                        if (typeof cmds === 'string') cmds = JSON.parse(cmds);
                    } catch (e) {
                        bridgeLog('poll: JSON 解析失败 → ' + result);
                        return;
                    }
                    if (!Array.isArray(cmds)) {
                        bridgeLog('poll: 非数组 → ' + result);
                        return;
                    }
                    if (cmds.length > 0) bridgeLog('poll: 收到 ' + JSON.stringify(cmds));
                    cmds.forEach(function (c) {
                        try {
                            handleCommand(c.cmd, c.payload);
                        } catch (e) {
                            bridgeLog('handleCommand 异常: ' + e);
                        }
                    });
                }
            );
        } catch (e) {
            bridgeLog('poll: evaluateJavascript 调用失败 → ' + e);
        }
    });
}, 600);

/* 首次运行：写入默认合规配置并记录 */
compliance.audit('APP_LAUNCH', 'v7.2.5');
if (!files.exists(files.cwd() + '/data/config.json')) {
    compliance.saveConfig({});
    compliance.audit('CONFIG_INIT', '写入默认合规配置');
}

/* 自检开关：data/selftest.flag 存在则 3 秒后自动提交一次任务（免 UI 复测桥接） */
if (files.exists(files.cwd() + '/data/selftest.flag')) {
    files.remove(files.cwd() + '/data/selftest.flag');
    const ssid = (compliance.config().whitelist[0] || '').trim();
    bridgeLog('selftest: 3 秒后自动提交任务 ssid=' + ssid);
    setTimeout(function () {
        handleCommand('start_task', { ssid: ssid, maxAttempts: 50, intervalSec: 3 });
    }, 3000);
}
bridgeLog('main.js 启动完成');

/* 启动时无障碍引导：未开启则自动跳到「已下载应用」里的 AutoX.js 无障碍开关
 * Android 不允许第三方代码直接打开无障碍开关，只能跳转设置页由用户点一次。
 * 已开启则静默跳过。仅引导一次，避免循环跳转。 */
setTimeout(function () {
    try {
        // 可靠检测：读系统安全设置里的无障碍组件列表，确认含 AutoX 组件
        var accOn = false;
        try {
            importClass(android.provider.Settings);
            var comp = 'org.autojs.autoxjs.v7/com.stardust.autojs.core.accessibility.AccessibilityService';
            var enabled = Settings.Secure.getString(context.getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) || '';
            var enabledInt = Settings.Secure.getInt(context.getContentResolver(), Settings.Secure.ACCESSIBILITY_ENABLED, 0);
            accOn = (enabledInt === 1) && enabled.toLowerCase().indexOf(comp.toLowerCase()) >= 0;
        } catch (eCheck) {
            accOn = !!(auto && auto.service); // 退回 auto.service 判断
        }
        bridgeLog('无障碍检测: ' + (accOn ? '已开启' : '未开启'));
        if (accOn) return;
        toast('请先开启 AutoX.js 无障碍服务（已跳转设置页）');
        var comp = 'org.autojs.autoxjs.v7/com.stardust.autojs.core.accessibility.AccessibilityService';
        try {
            app.startActivity({
                action: 'android.settings.ACCESSIBILITY_SETTINGS',
                extras: {
                    ':settings:fragment_args_key': comp,
                    ':settings:show_fragment_args': { ':settings:fragment_args_key': comp }
                }
            });
            bridgeLog('已跳转无障碍设置页（定位 ' + comp + '）');
        } catch (eJump) {
            // 带 extra 跳转失败则退回普通无障碍设置页
            app.startActivity({ action: 'android.settings.ACCESSIBILITY_SETTINGS' });
            bridgeLog('跳转普通无障碍设置页: ' + eJump);
        }
    } catch (e) {
        bridgeLog('无障碍引导异常: ' + e);
    }
}, 1500);

/* 白名单权威来源在原生 config.json，启动后下发到 UI */
setTimeout(function () {
    pushEvent('init_whitelist', { list: compliance.config().whitelist });
}, 1200);

