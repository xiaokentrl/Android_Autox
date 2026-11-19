// 运维：停止所有正在运行的脚本
let k = 0;
try {
    engines.all().forEach(function (e) {
        try { e.forceStop(); k++; } catch (e2) {}
    });
} catch (e) {}
toast('已停止脚本: ' + k);
sleep(600);
exit();
