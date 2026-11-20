#!/usr/bin/env bash
# deploy/push.sh — 一键推送 app/ 到手机
# 用法：bash deploy/push.sh             （推送 + 尝试自动启动并验证）
#       bash deploy/push.sh --no-run    （只推送，不启动）
#       bash deploy/push.sh --run       （显式自动启动，行为同默认）
set -e

ADB="/d/tools/微信web开发者工具/bin/adb-win/adb.exe"
DEV="8d5ff92f"
SRC="$(cygpath -w "$(cd "$(dirname "$0")/.." && pwd)/app")"
DST="/sdcard/脚本/WiFi字典轮询器"
PKG_ACTIVITY="org.autojs.autoxjs.v7/org.autojs.autojs.external.open.RunIntentActivity"
LOG="$DST/data/bridge.log"

if ! "$ADB" -s "$DEV" get-state >/dev/null 2>&1; then
    echo "✗ 设备 $DEV 未连接或未授权"; exit 1
fi

echo "→ 推送 $SRC"
MSYS_NO_PATHCONV=1 "$ADB" -s "$DEV" push "$SRC/." "$DST/"

count_launches() {
    MSYS_NO_PATHCONV=1 "$ADB" -s "$DEV" shell "grep -c '启动完成' $LOG 2>/dev/null | tail -1" 2>/dev/null | tr -d '\r' | grep -E '^[0-9]+$' || echo 0
}

run_script() {
    local before after
    before="$(count_launches)"
    # 用 file:// URI：纯路径在 adb shell 层会被吞掉，file:// 能正确传入 -d
    MSYS_NO_PATHCONV=1 "$ADB" -s "$DEV" shell am start \
        -n "$PKG_ACTIVITY" -d "file://$DST/main.js" >/dev/null 2>&1 || true
    sleep 4
    after="$(count_launches)"
    if [ "$after" -gt "$before" ]; then
        echo "✓ main.js 已自动启动"
    else
        echo "✗ 自动启动未生效（adb 启动常被 MIUI 拦截）"
        echo "  请在手机上手动运行：AutoX.js → 脚本 → WiFi字典轮询器 → main.js → ▶"
    fi
}

case "$1" in
    --no-run)
        echo "→ 仅推送完成（未启动）。手动运行：AutoX.js → 脚本 → WiFi字典轮询器 → main.js → ▶"
        ;;
    *)
        echo "→ 尝试启动 main.js"
        run_script
        ;;
esac
