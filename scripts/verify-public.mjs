import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const files = execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
assert.ok(files.length,'Public repository has staged or committed files');
for(const file of files){
  assert.ok(!/^(src\/(content|data|user)\/|public\/|\.content-src\/|\.content-backup\/|dist\/|\.env(?:\.|$))/.test(file) || file==='.env.example',`Private or generated file tracked: ${file}`);
  assert.ok(!/\.local\.md$/.test(file),`Local document tracked: ${file}`);
  if(!fs.existsSync(file)) continue;
  const text=fs.readFileSync(file,'utf8');
  assert.ok(!/(github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|-----BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY-----|https:\/\/[^\s/]+:[^\s@/]+@github\.com)/.test(text),`Possible credential in ${file}`);
}
console.log(`Checked ${files.length} tracked files for private content boundaries and common credential patterns.`);
