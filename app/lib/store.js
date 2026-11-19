/**
 * store.js — JSON 数据存取封装
 * data/ 目录运行时生成，随项目目录走
 */
const DATA_DIR = files.cwd() + '/data/';

function ensureDataDir() {
    if (!files.exists(DATA_DIR)) {
        files.createWithDirs(DATA_DIR + '.keep');
    }
}

/** 读取 JSON 文件，不存在或损坏返回 fallback */
function load(name, fallback) {
    ensureDataDir();
    const path = DATA_DIR + name;
    if (!files.exists(path)) return fallback;
    try {
        return JSON.parse(files.read(path));
    } catch (e) {
        console.error('[store] 解析失败: ' + name + ' → ' + e);
        return fallback;
    }
}

/** 原子写 JSON 文件（先写临时文件再改名） */
function save(name, obj) {
    ensureDataDir();
    const path = DATA_DIR + name;
    const tmp = path + '.tmp';
    files.write(tmp, JSON.stringify(obj, null, 2));
    files.remove(path);
    files.move(tmp, path);
}

/** 追加一行文本日志（审计 / 运行日志用） */
function appendLine(name, line) {
    ensureDataDir();
    files.append(DATA_DIR + name, line + '\n');
}

module.exports = { load, save, appendLine, DATA_DIR };
