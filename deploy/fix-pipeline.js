// 修复：applyRules 管线重排 + expandNums 正则转义修复
const fs = require('fs');
const p = 'E:/Android_Autox/app/web/index.html';
let s = fs.readFileSync(p, 'utf8');

const oldFn = `function expandNums(v){
  const out = [];
  v.split(/[,，]+/).map(function(t){ return t.trim(); }).filter(Boolean).forEach(function(t){
    const m = t.match(/^(\\\\d+)-(\\\\d+)$/);
    if(m){
      const a = parseInt(m[1], 10), b = parseInt(m[2], 10);
      if(b - a <= 10000){
        for(let i = Math.min(a, b); i <= Math.max(a, b); i++) out.push(String(i));
      }
    } else out.push(t);
  });
  return out;
}
function applyRules(lines, r){
  let out = lines.filter(function(s){ return s.length > 0; });
  // 扩展规则：先变换内容
  if(r.varCase){
    const exp = [];
    out.forEach(function(l){
      exp.push(l, l.charAt(0).toUpperCase() + l.slice(1), l.toUpperCase());
    });
    out = exp;
  }
  if(r.prefix) out = out.map(function(s){ return r.prefix + s; });
  if(r.suffix) out = out.map(function(s){ return s + r.suffix; });
  if(r.nums){
    const nums = expandNums(r.nums);
    const exp = [];
    out.forEach(function(l){ nums.forEach(function(x){ exp.push(l + x); }); });
    out = exp;
  }
  if(r.lower) out = out.map(function(s){ return s.toLowerCase(); });
  const seen = Object.create(null);
  out = out.filter(function(s){
    const k = s.toLowerCase(); if(seen[k]) return false; seen[k] = 1; return true;
  });`;

const newFn = `function expandNums(v){
  const out = [];
  const BS = String.fromCharCode(92);
  const rangeRe = new RegExp('^(' + BS + 'd+)-(' + BS + 'd+)' + BS + 's*' + BS + '$');
  v.split(/[,，]+/).map(function(t){ return t.trim(); }).filter(Boolean).forEach(function(t){
    const m = t.match(rangeRe);
    if(m){
      const a = parseInt(m[1], 10), b = parseInt(m[2], 10);
      if(b - a <= 10000){
        for(let i = Math.min(a, b); i <= Math.max(a, b); i++) out.push(String(i));
      }
    } else out.push(t);
  });
  return out;
}
function applyRules(lines, r){
  let out = lines.filter(function(s){ return s.length > 0; });
  // 扩展规则：先变换内容（变体/追加数字/前后缀）
  if(r.varCase){
    const exp = [];
    out.forEach(function(l){
      exp.push(l, l.charAt(0).toUpperCase() + l.slice(1), l.toUpperCase());
    });
    out = exp;
  }
  if(r.nums){
    const nums = expandNums(r.nums);
    const exp = [];
    out.forEach(function(l){ nums.forEach(function(x){ exp.push(l + x); }); });
    out = exp;
  }
  if(r.prefix) out = out.map(function(s){ return r.prefix + s; });
  if(r.suffix) out = out.map(function(s){ return s + r.suffix; });
  // 全小写在变体之后（两者同时启用时，最终结果为小写）
  if(r.lower) out = out.map(function(s){ return s.toLowerCase(); });
  // 去重：变体开启时按精确大小写（否则变体无意义），否则忽略大小写
  const seen = Object.create(null);
  const caseKey = r.varCase
    ? function(s){ return s; }
    : function(s){ return s.toLowerCase(); };
  out = out.filter(function(s){
    const k = caseKey(s); if(seen[k]) return false; seen[k] = 1; return true;
  });`;

if (s.indexOf(oldFn) < 0) { console.error('旧管线 anchor miss'); process.exit(1); }
s = s.replace(oldFn, newFn);
fs.writeFileSync(p, s);
console.log('管线重排完成');
