// 重建 main.js 的 get_logs/clear_runtime_log/export_logs 三个命令块（修复转义损坏）
const fs = require('fs');
const p = 'E:/Android_Autox/app/main.js';
let s = fs.readFileSync(p, 'utf8');

const startAnchor = "    } else if (cmd === 'get_logs') {";
const endAnchor = "    } else if (cmd === 'pause_task') {";
const si = s.indexOf(startAnchor);
const ei = s.indexOf(endAnchor);
if (si < 0 || ei < 0 || ei <= si) { console.error('区域定位失败', si, ei); process.exit(1); }

// 目标代码：\n 写成 \\n（写入目标文件后为转义序列而非真实换行）
const block = `    } else if (cmd === 'get_logs') {
        threads.start(function () {
            function tail(name, n) {
                const p = files.cwd() + '/data/' + name;
                if (!files.exists(p)) return [];
                const lines = files.read(p).split(/\\r?\\n/)
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
                    out += '===== ' + name + ' =====\\n' + files.read(dir + name) + '\\n\\n';
                }
            });
            const dest = '/sdcard/Download/wifipoller-logs-' + Date.now() + '.txt';
            files.write(dest, out);
            toast('已导出到：' + dest);
        });
    }
`;
s = s.slice(0, si) + block + s.slice(ei);
fs.writeFileSync(p, s);
console.log('三个命令块已重建');
