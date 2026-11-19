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
 * 取候选密码序列：按文件名顺序合并全部字典 → 去重 → 截断到 maxAttempts
 * （权重、启用开关、规则链留待后续版本接入设置页）
 */
function candidates(maxAttempts) {
    const meta = store.load('dictmeta.json', {});
    const all = [];
    loadDicts().forEach(function (d) {
        const m = meta[d.name] || {};
        if (m.enabled === false) return; // 停用的字典不参与候选
        all.push.apply(all, d.entries);
    });
    return dedupe(all).slice(0, maxAttempts);
}

module.exports = { loadDicts, dedupe, candidates, DICT_DIR };
