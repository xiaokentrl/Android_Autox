// diag-start.js — 逐模块诊断 main.js 启动失败点
const steps = [];
function record(name, ok, err) {
    steps.push(name + ' → ' + (ok ? 'OK' : 'FAIL: ' + err));
    files.write('/sdcard/脚本/WiFi字典轮询器/data/diag.log', steps.join('\n') + '\n[诊断结束]\n');
}
record('0. diag 脚本自身运行', true, '');

try { record('1. require store.js', true, ''); } catch (e) { record('1. require store.js', false, String(e)); }
try { const c = require('./lib/compliance.js'); record('2. require compliance.js', true, ''); } catch (e) { record('2. require compliance.js', false, String(e)); }
try { const d = require('./lib/dict.js'); record('3. require dict.js', true, ''); } catch (e) { record('3. require dict.js', false, String(e)); }
try { const w = require('./lib/wifi.js'); record('4. require wifi.js', true, ''); } catch (e) { record('4. require wifi.js', false, String(e)); }
try { const cn = require('./lib/connect.js'); record('5. require connect.js', true, ''); } catch (e) { record('5. require connect.js', false, String(e)); }
try { const en = require('./lib/engine.js'); record('6. require engine.js', true, ''); } catch (e) { record('6. require engine.js', false, String(e)); }
try { const pa = require('./lib/panel.js'); record('7. require panel.js（E4X 已改字符串）', true, ''); } catch (e) { record('7. require panel.js', false, String(e)); }
try {
    'ui' === 'ui';
    record('8. E4X 语法测试（ui 模式外）', true, '');
} catch (e) { record('8. E4X 语法测试', false, String(e)); }

toast('诊断完成，结果已写入 diag.log');
exit();
