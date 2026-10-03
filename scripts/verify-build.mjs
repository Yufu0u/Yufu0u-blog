import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve('dist');
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, {withFileTypes:true})) {
    const file = path.join(dir,entry.name);
    if (entry.isDirectory()) walk(file);
    else if(entry.name.endsWith('.html')) files.push(file);
  }
}
walk(root);
const home = fs.readFileSync(path.join(root,'index.html'),'utf8');
const canonicalTag = [...home.matchAll(/<link\b[^>]*>/g)].map(m=>m[0]).find(tag=>/\brel="canonical"/.test(tag));
const canonical = canonicalTag?.match(/\bhref="([^"]+)"/);
assert.ok(canonical, 'Homepage has a canonical URL');
const site = new URL(canonical[1]).origin;
const broken = new Set();
for (const file of files) {
  const html = fs.readFileSync(file,'utf8');
  const base = new URL(path.relative(root,file).split(path.sep).join('/'),site+'/');
  for (const [,value] of html.matchAll(/\b(?:href|src|poster)\s*=\s*["']([^"'<>]+)["']/g)) {
    if (/^(#|data:|mailto:|tel:|javascript:)/i.test(value)) continue;
    const url = new URL(value.replace(/&amp;/g,'&'),base);
    if(url.origin!==site) continue;
    const target = path.resolve(root,decodeURIComponent(url.pathname).replace(/^\/+/,''));
    if(!target.startsWith(root+path.sep) && target!==root) throw new Error('Asset escapes output');
    if(!(fs.existsSync(target) && fs.statSync(target).isFile()) && !fs.existsSync(path.join(target,'index.html'))) broken.add(path.relative(root,file)+' -> '+url.pathname);
  }
}
assert.deepEqual([...broken],[],'All local links and assets exist');
for(const file of ['404.html','pagefind/pagefind.js','sitemap-index.xml','robots.txt']) assert.ok(fs.existsSync(path.join(root,file)),file+' exists');
console.log(`Verified ${files.length} HTML pages, local links, assets, canonical, sitemap, robots and search.`);
