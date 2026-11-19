// 运维：停止所有正在运行的脚本（结果落盘验证）
let k = 0;
const names = [];
try {
    engines.all().forEach(function (e) {
        try {
            names.push(String(e.getSource && e.getSource() || '?').slice(-20));
            e.forceStop();
            k++;
        } catch (e2) { names.push('ERR:' + e2); }
    });
} catch (e) {}
files.write('/sdcard/脚本/WiFi字典轮询器/data/kill.log',
    new Date().toLocaleTimeString() + ' 停止 ' + k + ' 个: [' + names.join(' | ') + ']\n');
toast('已停止脚本: ' + k);
sleep(600);
exit();
