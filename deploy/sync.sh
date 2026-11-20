#!/usr/bin/env bash
# deploy/sync.sh — 一键同步：自动重连 → 推送 → 本地自测 → 启动脚本
# 用法：bash deploy/sync.sh          （推送 + 测试 + 启动）
#       bash deploy/sync.sh --no-run （只推送 + 测试，不启动）
# 设备掉线时自动重连，无需人工干预。
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ADB="/d/tools/微信web开发者工具/bin/adb-win/adb.exe"
DEV="8d5ff92f"
PKG="org.autojs.autoxjs.v7"
ACT="$PKG/org.autojs.autojs.external.open.RunIntentActivity"

echo "=== 1. 自动重连设备 $DEV ==="
ONLINE=0
for i in $(seq 1 20); do
    ST="$("$ADB" -s "$DEV" get-state 2>/dev/null || true)"
    if [ "$ST" = "device" ]; then
        echo "  设备已在线（第 $i 次检查）"
        ONLINE=1
        break
    fi
    if [ $((i % 3)) -eq 0 ]; then
        "$ADB" reconnect >/dev/null 2>&1 || true
        "$ADB" kill-server >/dev/null 2>&1 || true
        "$ADB" start-server >/dev/null 2>&1 || true
    fi
    sleep 2
done
if [ "$ONLINE" -ne 1 ]; then
    echo "  ✗ 设备 20 次检查后仍离线，请检查 USB/解锁/授权"; exit 1
fi

echo "=== 2. 本地自测 ==="
cd "$ROOT"
node deploy/check-bridge.js || exit 1
node deploy/check-exports.js || exit 1
node deploy/test-engine.js | grep -E '结果|FAIL' || exit 1
node deploy/test-rules.js  | grep -E '结果|FAIL' || exit 1

echo "=== 3. 推送到手机 ==="
bash deploy/push.sh --no-run

echo "=== 4. 启动脚本 ==="
if [ "$1" = "--no-run" ]; then
    echo "  跳过启动（--no-run）"
else
    "$ADB" -s "$DEV" shell am force-stop "$PKG" || true
    sleep 1
    "$ADB" -s "$DEV" shell "monkey -p $PKG -c android.intent.category.LAUNCHER 1" >/dev/null 2>&1 || true
    # force-stop 常导致 USB 掉线，这里再自动重连一次
    sleep 2
    for i in $(seq 1 10); do
        ST="$("$ADB" -s "$DEV" get-state 2>/dev/null || true)"
        if [ "$ST" = "device" ]; then echo "  已打开 AutoX.js，设备在线"; break; fi
        "$ADB" reconnect >/dev/null 2>&1 || true
        sleep 2
    done
    echo "  请在手机上手动运行 main.js（或观察是否自动启动）"
fi

echo "=== 完成 ==="
