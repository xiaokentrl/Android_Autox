let k = 0;
try { engines.all().forEach(function (e) { try { e.forceStop(); k++; } catch (e2) {} }); } catch (e) {}
toast('stopped ' + k);
sleep(500);
exit();
