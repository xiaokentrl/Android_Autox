# WiFi 字典轮询器（AutoX.js）

## 总纲

**定位**：景区 WiFi 运维工具——对自有/已授权网络做密码找回与强度自测。真实引擎，真实场景使用。

**授权模型（声明制）**
- 目标网络白名单由使用者自行输入；输入即代表使用者声明该网络为其自有或已获书面授权
- 本 App 仅限运营者自有设备使用，**不得对外分发**（不分发给客户/游客/第三方）
- 合规层在代码级强制，UI 不可绕过：
  - 每目标尝试次数硬上限 50 次（`compliance.CAPS.MAX_ATTEMPTS`）
  - 单任务目标数上限 20 个（`compliance.CAPS.MAX_TARGETS`），即单任务总尝试 ≤1000 次
  - 最小尝试间隔 1 秒（`compliance.CAPS.MIN_INTERVAL_SEC`）
  - SSID 不在白名单内直接拒绝执行
  - 审计日志强制记录（授权确认/任务起止/白名单变更/命中），不可关闭

**真实引擎（attemptConnect）**
- 方案：无障碍服务自动化系统 WLAN 设置界面（Android 10+ 第三方 App 无法程序化创建连接，UI 自动化是唯一通用路径）
- 结果枚举：`connected` / `wrong_password` / `timeout` / `not_found`
- 每次尝试：打开 WLAN 设置 → 定位目标 SSID → 输入密码 → 连接 → 按系统反馈判定 → 返回
- 前提：AutoX.js 无障碍服务已开启（设置页「权限向导」跳转）

**开发纪律**
- 所有功能按真实场景开发：写死的演示数据不得进入主流程（只允许出现在浏览器预览分支）
- 每个里程碑实机验证后才算完成（adb 截屏 + 日志落盘双证据）

## 目录结构

```
E:\Android_Autox\                     PC 工作区
├── WiFi字典轮询器UI设计.html          UI 原型原稿（存档）
├── docs\
│   └── README.md                      本文档
├── deploy\
│   └── push.sh                        一键推送 + 自动运行（不进手机）
└── app\  ──────────────────────────  /sdcard/脚本/WiFi字典轮询器/（1:1 镜像）
    ├── project.json                   项目清单（AutoX.js 识别入口）
    ├── main.js                        入口：WebView 宿主 + 命令轮询桥
    ├── lib\
    │   ├── store.js                   JSON 存取 / 日志追加
    │   ├── compliance.js              合规层（白名单/硬上限/审计）
    │   ├── dict.js                    字典加载/去重/候选序列
    │   ├── wifi.js                    附近 WiFi 扫描（白名单选择用）
    │   ├── connect.js                 真实连接（无障碍自动化 WLAN）
    │   ├── panel.js                   悬浮窗控制面板
    │   └── engine.js                  轮询循环（调用 connect.js）
    ├── web\
    │   └── index.html                 全部 UI（原型改造，全屏版）
    ├── dicts\                         字典文件（txt 一行一条）
    │   └── _demo\                     演示字典（不参与真实任务）
    └── data\                          运行时生成（勿手写）
        ├── config.json                持久化合规配置
        ├── audit.log                  审计日志（强制）
        └── .keep
```

## 开发环境

| 项 | 值 |
|---|---|
| 手机 | Redmi（marble）· Android 15 · arm64-v8a |
| 设备号 | `8d5ff92f` |
| AutoX.js | `org.autojs.autoxjs.v7` |
| ADB | `D:\tools\微信web开发者工具\bin\adb-win\adb.exe` |

## 日常开发

```bash
bash deploy/push.sh            # 推送并自动运行 main.js
bash deploy/push.sh --no-run   # 只推送
```

远程单跑某个脚本（如 test.js）：

```bash
MSYS_NO_PATHCONV=1 adb -s 8d5ff92f shell am start \
  -n org.autojs.autoxjs.v7/org.autojs.autojs.external.open.RunIntentActivity \
  -d '/sdcard/脚本/WiFi字典轮询器/test.js'
```

> Git Bash 会把 `/sdcard/...` 转成本地路径，**必须加 `MSYS_NO_PATHCONV=1`**。

## 架构：轻量命令桥（无需 dex）

```
网页 UI (web/index.html)
   │  window.__cmdQueue.push({cmd,payload})      ← UI 操作产生命令
   │  ←── main.js 每 600ms evaluateJavascript 轮询取走
   ▼
main.js（原生）
   │  handleCommand → compliance 校验 → engine.start
   │  ──→ evaluateJavascript('__onNativeEvent(...)', 事件推回网页）
   ▼
lib/engine.js   任务循环（间隔节流/上限/审计），attemptConnect 为桩
```

在 PC 浏览器直接打开 `web/index.html` 也可用（无原生桥，走内置模拟路径）。

## 待办 / 里程碑

- [x] UI 原型 → 全屏版 + 持久化 + 桥接适配层
- [x] AutoX.js 项目骨架 + 合规层 + 引擎循环
- [x] 白名单真实扫描（信号降序 / 全选）+ 批量导入（粘贴 / whitelist.txt 文件）
- [x] 白名单表格 UI：一行一个、默认 5 条、展开/收起（展开后滚动）、逐行删除、单个添加、
      信号强度列（▂▄▆█ + dBm，扫描快照驱动）、🔄 刷新信号、⇅ 按信号排序（未知在后）、▲▼ 手动排序；
      原生 config.json 为权威来源，启动时 init_whitelist 下发 UI（localStorage 键 v2）
      注：改 UI 代码后必须「返回键退出 + Intent 重拉」才会加载新 HTML（WebView 不自动刷新）
- [x] 悬浮窗控制面板 lib/panel.js：任务运行时显示进度+暂停/停止（屏幕被 WLAN 页占用时唯一可控入口），
      可拖动、view.post 跨线程更新、无权限时优雅降级；预览通道 data/preview.flag；
      引擎支持暂停/继续（TASK_PAUSE/TASK_RESUME 审计）；运行页暂停按钮接真引擎；首页左上角返回箭头
- [x] UI 白名单 ↔ 原生合规层双向同步（审计记录 WHITELIST_UPDATE）
- [x] 真实连接引擎 lib/connect.js（无障碍自动化：滚顶→定位 SSID→点击→分类弹层→判定
      connected/wrong_password/timeout/not_found/saved），TASK_START→尝试→TASK_END 全链路实机验证
- [x] 运行期控制：data/selftest.flag 触发测试任务、data/stop.flag 停止任务（main.js 轮询）
- [x] 单实例保护：启动时检测已有 main.js 执行则退出（engines.all/getSource）
- [x] 真机端到端自测（2026-11-20，两轮）：真实任务完整跑通（悬浮窗实时进度/引擎驱动 WLAN 页/
      日志审计全落盘）；分支定标进度：not_found ✓ saved(代码路径) ✓ timeout ✓ 暂停/停止 ✓——
      wrong_password/connected 分支待目标 AP 在线且未保存时定标（美宜佳为已保存网络点击直接连接）
- [ ] wrong_password/connected 分支定标：需一个自有且在线的未保存 AP（列表中可见且带密码框）
- [x] 日志页接真实数据：runtime.log + audit.log 双区块（最新在前）、进入自动刷新、
      🔄刷新 / 📤导出到 /sdcard/Download / 🧹清空运行日志（审计日志不可清空）；引擎尝试实时落盘 runtime.log

      注：MIUI 冷启动拦截——App 被杀后 Intent 拉起会被拦，需开自启动或手动打开；
      wifi.js requestPermissions 会中断脚本已改为 checkSelfPermission 只检查
- [x] 字典管理页实装：真实字典列表（dicts/*.txt + dictmeta.json 元数据）、统计、
      新建/删除/启用开关（停用字典不参与候选）、Download txt 一键导入、
      编辑页（内容 textarea 去空行+去重保存）、条目页（勾选删除）；命令 get_dicts/get_dict_entries/
      save_dict/create_dict/delete_dict/set_dict_enabled/list_download_txt/import_from_download；
      生成器与规则链仍为原型
- [x] 悬浮窗控制面板（见上）
- [x] 日志页接 audit.log / runtime.log（见上）
- [x] 任务历史持久化：data/history.json（最近 20 条，引擎生命周期驱动：运行中→命中/未命中/手动停止）；
      首页「最近任务」真实渲染（时间/目标/状态/命中列表），进入首页与任务结束自动刷新
- [x] 多目标批量轮询：任务页可选「白名单全部（按顺序，信号优先）」；引擎逐目标×字典轮询；
      命中策略可选（停止/继续并记录）；合规层逐目标校验白名单；悬浮窗/运行页显示当前目标；
      确认弹窗列出多目标；审计记录 targets 全列表。白名单排序即真实尝试顺序
- [x] 字典生成器实装（纯前端计算）：基础词×大小写变体×追加数字×leet 替换，
      长度过滤+去重+上限，预览 50 条，保存走 save_dict 落为真实字典
- [x] 保存规则链：dictEdit 全小写/长度过滤/正则保留/黑名单/长度升序，实时预览
      「原始/去重/规则后」三计数，规则随 dictmeta.json 持久化（重开自动回填）
- [x] 规则链高级规则：大小写变体（原样/首字母大写/全大写）/加前缀/加后缀/追加数字序列
      （范围 1990-2025 或逗号列表）；管线顺序=变体→数字→前后缀→小写→去重（变体开启时按精确
      大小写去重）→长度→正则→黑名单→排序；单测 15 用例全过（deploy/test-rules.js）

## 自测

- `node deploy/test-rules.js`：规则链 applyRules 15 用例（vm 沙箱，桩掉 DOM）
- `node deploy/test-engine.js`：多目标引擎状态机 9 用例（合规拒绝/命中/双目标/continue/停止/暂停/空字典/进度归零/控制回调下沉）
- `node deploy/check-exports.js`：模块导出完整性检查（含 panel.js）
- `node deploy/check-bridge.js`：桥接契约检查（UI nativeSend 命令必须有原生 handler）
- 历史教训：engine.js 曾导出未定义的 isRunning（引用即崩），自测抓出

## 运维备忘（MIUI marble 实测）

- 无障碍服务：MIUI 会重置 adb 方式启用和被 force-stop 的服务，必须在设置界面手动开；
  开启后 App 内「前台服务」建议打开防杀；强杀进程（am force-stop）会连累无障碍，重启脚本用
  「返回键正常退出 + Intent 重新拉起」或 App 通知栏「停止所有脚本」
- 管理页「运行中脚本」列表可见所有执行实例及 ✕ 停止按钮
- 拉起脚本失败时确认：AutoX 设置里「允许使用广播运行脚本」已开启
- WLAN 页控件（探针标定）：条目 LinearLayout clickable desc="SSID,已连接?,WLAN 信号强度为X格。,安全网络"，
  子 CheckedTextView text="SSID"；「已连接」只在 desc 中出现，text 中没有
