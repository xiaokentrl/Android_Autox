/**
 * dict.js — 字典管理
 *
 * 字典文件位于项目内 dicts/ 目录，txt 一行一条。
 * 职责：加载、去重（忽略大小写）、按启用列表过滤、
 *       按权重排序（权重高的字典整体靠前）。
 */
const DICT_DIR = files.cwd() + '/dicts/';
const store = require('./store.js');

/**
 * 加载全部字典文件
 * @returns {{name: string, entries: string[]}[]}
 */
function loadDicts() {
    const result = [];
    if (!files.exists(DICT_DIR)) return result;
    const list = files.listDir(DICT_DIR, function (name) {
        return name.endsWith('.txt');
    });
    list.forEach(function (name) {
        let entries = [];
        try {
            entries = files.read(DICT_DIR + name)
                .replace(/\r\n/g, '\n')
                .split('\n')
                .map(function (s) { return s.trim(); })
                .filter(function (s) { return s.length > 0; });
        } catch (e) {
            console.error('[dict] 读取失败: ' + name + ' → ' + e);
        }
        result.push({ name: name.replace(/\.txt$/, ''), entries: entries });
    });
    return result;
}

/** 忽略大小写去重，保持首次出现顺序 */
function dedupe(entries) {
    const seen = Object.create(null);
    return entries.filter(function (s) {
        const k = s.toLowerCase();
        if (seen[k]) return false;
        seen[k] = true;
        return true;
    });
}

/**
 * 取候选密码序列：按文件名顺序合并指定字典 → 去重 → 截断到 maxAttempts
 * @param maxAttempts 每目标最大尝试数
 * @param dictNames 可选，本次任务参与的字典名数组；不传=全部启用字典
 */
function candidates(maxAttempts, dictNames) {
    const meta = store.load('dictmeta.json', {});
    const all = [];
    const only = Array.isArray(dictNames) ? dictNames : null; // 传数组（含空数组）=按勾选过滤；不传=全部启用字典
    loadDicts().forEach(function (d) {
        const m = meta[d.name] || {};
        if (m.enabled === false) return; // 停用的字典不参与候选
        if (only && only.indexOf(d.name) < 0) return; // 本次任务未勾选
        all.push.apply(all, d.entries);
    });
    return dedupe(all).slice(0, maxAttempts);
}

module.exports = { loadDicts, dedupe, candidates, DICT_DIR };
