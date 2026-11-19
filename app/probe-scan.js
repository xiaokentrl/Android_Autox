// probe-scan.js — 用 app 的多轮合并逻辑实测（诊断用）
const wifi = require('./lib/wifi.js');
wifi.scan(function (networks, err) {
    let out = 'err=' + (err || '无') + ' 合并后=' + networks.length + ' 个\n';
    networks.forEach(function (n, i) {
        out += i + ': ' + n.ssid + ' ' + n.level + 'dBm ' + n.security + '\n';
    });
    files.write('/sdcard/脚本/WiFi字典轮询器/data/probe-scan.log', out);
    toast('多轮扫描完成');
    exit();
});
