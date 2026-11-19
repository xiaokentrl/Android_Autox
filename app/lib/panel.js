/**
 * panel.js — 悬浮窗控制面板
 *
 * 任务运行时屏幕被系统 WLAN 设置页占用，悬浮窗是唯一的暂停/停止入口。
 * 需要系统权限「显示在其他应用上层」。
 * 所有跨线程的界面更新走 view.post()。
 */
let win = null;

function ensureWin(callbacks) {
    // 用字符串 XML 而非 E4X：部分 AutoX 模块上下文不支持 E4X，require 时会语法报错
    const xml = '<frame gravity="left|top">'
        + '<vertical padding="8" bg="#CC14161B">'
        + '<text id="title" textSize="10" textColor="#8AE8EAED" text="轮询任务（可拖动）"/>'
        + '<text id="status" textSize="12" textColor="#FFFFFF" text="准备中"/>'
        + '<horizontal marginTop="4">'
        + '<button id="pauseBtn" text="⏸ 暂停" textSize="11" style="Widget.AppCompat.Button.Borderless" textColor="#5B8CFF"/>'
        + '<button id="stopBtn" text="⏹ 停止" textSize="11" style="Widget.AppCompat.Button.Borderless" textColor="#E5484D"/>'
        + '</horizontal>'
        + '</vertical>'
        + '</frame>';
    win = floaty.window(xml);
    // 按住标题栏拖动面板
    let lx = 0, ly = 0, wx = 0, wy = 0;
    win.title.setOnTouchListener(function (v, ev) {
        switch (ev.getAction()) {
            case ev.ACTION_DOWN:
                lx = ev.getRawX(); ly = ev.getRawY();
                wx = win.getX(); wy = win.getY();
                return true;
            case ev.ACTION_MOVE:
                win.setPosition(wx + (ev.getRawX() - lx), wy + (ev.getRawY() - ly));
                return true;
        }
        return false;
    });
    win.pauseBtn.on('click', function () { callbacks.onPause(); });
    win.stopBtn.on('click', function () { callbacks.onStop(); });
}

/** 创建面板；失败（无权限等）返回 false，不影响任务继续 */
function create(titleText, callbacks) {
    close();
    try {
        ensureWin(callbacks);
        update(titleText);
        return true;
    } catch (e) {
        console.error('[panel] 创建失败: ' + e);
        toast('悬浮窗创建失败，请开启「显示在其他应用上层」权限');
        win = null;
        return false;
    }
}

/** 更新状态文字（可在任意线程调用） */
function update(text) {
    if (!win) return;
    win.status.post(function () {
        try { win.status.setText(String(text)); } catch (e) {}
    });
}

/** 暂停/继续按钮文案 */
function setPaused(p) {
    if (!win) return;
    win.pauseBtn.post(function () {
        try { win.pauseBtn.setText(p ? '▶ 继续' : '⏸ 暂停'); } catch (e) {}
    });
}

function close() {
    if (!win) return;
    try { win.close(); } catch (e) {}
    win = null;
}

function isOpen() { return !!win; }

module.exports = { create, update, setPaused, close, isOpen };
