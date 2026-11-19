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

/* 单实例保护：已有 main.js 在执行则本次直接退出（防 Intent 重启叠加出僵尸实例） */
try {
    const storeGuard = require('./lib/store.js');
    const myId = String(engines.myEngine().getId());
    let dup = false, seen = [];
    engines.all().forEach(function (e) {
        const src = String(e.getSource && e.getSource() || '');
        const id = String(e.getId && e.getId() || '');
        seen.push(id + '|' + src.slice(0, 40));
        if (src.indexOf('main.js') >= 0 && id !== myId) dup = true;
    });
    storeGuard.appendLine('bridge.log', 'guard: my=' + myId + ' dup=' + dup + ' all=[' + seen.join('; ') + ']');
    if (dup) {
        console.log('[main] 已有实例在运行，本次启动退出');
        exit();
    }
} catch (eGuard) {
    console.error('[main] 单实例检查异常: ' + eGuard);
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
function handleCommand(cmd, payload) {
    if (cmd === 'start_task') {
        // UI 侧白名单同步进合规层（UI 编辑以本次任务携带为准）
        if (payload && Array.isArray(payload.whitelist) && payload.whitelist.length > 0) {
            compliance.saveConfig({ whitelist: payload.whitelist });
            compliance.audit('WHITELIST_UPDATE', payload.whitelist.join(', '));
        }
        compliance.recordAuthConfirmation();
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
                    pushEvent('progress', p);
                },
                onDone: function (success, reason) {
                    panel.close();
                    toast('任务' + (success ? '成功' : '结束') + (reason ? '：' + reason : ''));
                    pushEvent('task_done', { success: success, reason: reason });
                },
            });
        });
    } else if (cmd === 'stop_task') {
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
    } else if (cmd === 'get_logs') {
        threads.start(function () {
            function tail(name, n) {
                const p = files.cwd() + '/data/' + name;
                if (!files.exists(p)) return [];
                const lines = files.read(p).split(/\r?\n/)
                    .map(function (s) { return s.trim(); })
                    .filter(function (s) { return s.length > 0; });
                return lines.slice(-n).reverse(); // 最新在前
            }
            pushEvent('logs_data', { audit: tail('audit.log', 80), runtime: tail('runtime.log', 80) });
        });
    } else if (cmd === 'clear_runtime_log') {
        threads.start(function () {
            files.write(files.cwd() + '/data/runtime.log', '');
            compliance.audit('RUNTIME_LOG_CLEAR', '用户清空运行日志');
            pushEvent('logs_data', { audit: [], runtime: [] });
        });
    } else if (cmd === 'export_logs') {
        threads.start(function () {
            const dir = files.cwd() + '/data/';
            let out = '';
            ['runtime.log', 'audit.log'].forEach(function (name) {
                if (files.exists(dir + name)) {
                    out += '===== ' + name + ' =====\n' + files.read(dir + name) + '\n\n';
                }
            });
            const dest = '/sdcard/Download/wifipoller-logs-' + Date.now() + '.txt';
            files.write(dest, out);
            toast('已导出到：' + dest);
        });
    } else if (cmd === 'pause_task') {
        engine.pause();
        panel.setPaused(true);
    } else if (cmd === 'resume_task') {
        engine.resume();
        panel.setPaused(false);
    } else if (cmd === 'get_whitelist') {
        // 页面就绪后主动拉取（避免 init 推送与页面加载竞态）
        pushEvent('init_whitelist', { list: compliance.config().whitelist });
    } else if (cmd === 'set_whitelist') {
        if (payload && Array.isArray(payload.list)) {
            compliance.saveConfig({ whitelist: payload.list });
            compliance.audit('WHITELIST_UPDATE', payload.list.join(', '));
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

/* 白名单权威来源在原生 config.json，启动后下发到 UI */
setTimeout(function () {
    pushEvent('init_whitelist', { list: compliance.config().whitelist });
}, 1200);
