#!/usr/bin/env bash
# deploy/push.sh — 一键推送 app/ 到手机并自动运行
# 用法：bash deploy/push.sh        （推送 + 自动运行 main.js）
#       bash deploy/push.sh --no-run （只推送不运行）
set -e

ADB="/d/tools/微信web开发者工具/bin/adb-win/adb.exe"
DEV="8d5ff92f"
SRC="$(cygpath -w "$(cd "$(dirname "$0")/.." && pwd)/app")"
DST="/sdcard/脚本/WiFi字典轮询器"
PKG_ACTIVITY="org.autojs.autoxjs.v7/org.autojs.autojs.external.open.RunIntentActivity"

if ! "$ADB" -s "$DEV" get-state >/dev/null 2>&1; then
    echo "✗ 设备 $DEV 未连接或未授权"; exit 1
fi

echo "→ 推送 $SRC"
MSYS_NO_PATHCONV=1 "$ADB" -s "$DEV" push "$SRC/." "$DST/"

if [ "$1" != "--no-run" ]; then
    echo "→ 启动 main.js"
    MSYS_NO_PATHCONV=1 "$ADB" -s "$DEV" shell am start \
        -n "$PKG_ACTIVITY" -d "$DST/main.js" >/dev/null
    echo "✓ 已触发运行（约 2 秒后 UI 出现在手机上）"
fi
