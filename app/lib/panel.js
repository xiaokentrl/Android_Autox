/**
 * panel.js — 悬浮窗控制面板
 *
 * 任务运行时屏幕被系统 WLAN 设置页占用，悬浮窗是唯一的状态/密码显示与暂停/停止入口。
 * 需要系统权限「显示在其他应用上层」+「前台服务」才能在切到 WLAN 页后持续置顶。
 * 整个面板（除按钮外）可拖动，位置持久化到 data/panel_pos.json，重开时钉回原位。
 * 所有跨线程的界面更新走 view.post()。
 */
const W = require('./store.js');
let win = null;
let lastTitle = '';
let panelCallbacks = null;
const POS_FILE = 'panel_pos.json';

function loadPos() {
    try { return W.load(POS_FILE, null); } catch (e) { return null; }
}
function savePos() {
    if (!win) return;
    try { W.save(POS_FILE, { x: win.getX(), y: win.getY() }); } catch (e) {}
}

/** 给指定控件绑定拖动（按下记起点，移动改位置，抬起存位置） */
function attachDrag(view) {
    var lx = 0, ly = 0, wx = 0, wy = 0;
    view.setOnTouchListener(function (v, ev) {
        switch (ev.getAction()) {
            case ev.ACTION_DOWN:
                lx = ev.getRawX(); ly = ev.getRawY();
                wx = win.getX(); wy = win.getY();
                return true;
            case ev.ACTION_MOVE:
                win.setPosition((wx + ev.getRawX() - lx) | 0, (wy + ev.getRawY() - ly) | 0);
                return true;
            case ev.ACTION_UP:
                savePos();
                return false;
        }
        return false;
    });
}

function ensureWin() {
    // 用字符串 XML 而非 E4X：部分 AutoX 模块上下文不支持 E4X，require 时会语法报错
    const xml = '<frame gravity="left|top">'
        + '<vertical padding="8" bg="#CC14161B">'
        + '<text id="title" textSize="10" textColor="#8AE8EAED" text="轮询任务（可拖动）"/>'
        + '<text id="status" textSize="12" textColor="#FFFFFF" text="准备中"/>'
        + '<text id="pwd" textSize="15" textColor="#FFD84A" textStyle="bold" text="密码：—"/>'
        + '<horizontal marginTop="4">'
        + '<button id="pauseBtn" text="⏸ 暂停" textSize="11" style="Widget.AppCompat.Button.Borderless" textColor="#5B8CFF"/>'
        + '<button id="stopBtn" text="⏹ 停止" textSize="11" style="Widget.AppCompat.Button.Borderless" textColor="#E5484D"/>'
        + '</horizontal>'
        + '</vertical>'
        + '</frame>';
    win = floaty.window(xml);
    // 整个面板（标题/状态/密码行）都可拖动，按钮保持可点
    attachDrag(win.title);
    attachDrag(win.status);
    attachDrag(win.pwd);
    // 间接引用 panelCallbacks：每次 create 更新它即可重绑，避免闭包固化到首次回调
    win.pauseBtn.on('click', function () {
        if (panelCallbacks && panelCallbacks.onPause) panelCallbacks.onPause();
    });
    win.stopBtn.on('click', function () {
        if (panelCallbacks && panelCallbacks.onStop) panelCallbacks.onStop();
    });
}

/** 创建面板；幂等：已打开则只更新内容，不销毁重建（避免闪烁） */
function create(titleText, callbacks) {
    try {
        // 每次创建都更新回调，暂停/停止按钮始终指向当前任务
        if (callbacks) panelCallbacks = callbacks;
        if (!win) {
            ensureWin();
            // 钉回上次拖动的位置；首次用默认位置
            var pos = loadPos();
            if (pos && pos.x != null && pos.y != null) {
                try { win.setPosition(pos.x, pos.y); } catch (e) {}
            } else {
                try { win.setPosition(20, 120); } catch (e) {}
            }
            // 保持可触摸，减少 MIUI 切后台时把悬浮窗当临时提示层隐藏
            try { win.setTouchable(true); } catch (e) {}
        }
        lastTitle = titleText;
        update(titleText);
        setPwd('—');
        if (callbacks) panelCallbacks = callbacks;
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

/** 更新当前密码显示（可在任意线程调用） */
function setPwd(pwd) {
    if (!win) return;
    var p = (pwd === null || pwd === undefined || pwd === '') ? '—' : String(pwd);
    win.pwd.post(function () {
        try { win.pwd.setText('密码：' + p); } catch (e) {}
    });
}

/** 暂停/继续按钮文案 */
function setPaused(p) {
    if (!win) return;
    win.pauseBtn.post(function () {
        try { win.pauseBtn.setText(p ? '▶ 继续' : '⏸ 暂停'); } catch (e) {}
    });
}

/** 重置位置：删除保存的位置并移回默认位置 */
function resetPos() {
    try { files.remove(W.DATA_DIR + POS_FILE); } catch (e) {}
    if (win) { try { win.setPosition(20, 120); } catch (e) {} }
}

function close() {
    if (!win) return;
    try { win.close(); } catch (e) {}
    win = null;
    panelCallbacks = null;
}

function isOpen() { return !!win; }

module.exports = { create, update, setPwd, setPaused, resetPos, close, isOpen };
