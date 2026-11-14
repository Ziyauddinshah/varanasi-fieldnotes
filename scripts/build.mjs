import fs from 'node:fs';
import path from 'node:path';
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.webp':'image/webp'};
const assets={};
function walk(dir) {
  for (const file of fs.readdirSync(dir).sort()) {
    const filename=path.join(dir,file);
    if (fs.statSync(filename).isDirectory()) walk(filename);
    else assets['/'+path.relative('public',filename).split(path.sep).join('/')]={type:types[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(filename).toString('base64')};
  }
}
walk('public');
const inline=filename=>fs.readFileSync(filename,'utf8').replace(/^import .*from '\.\/http\.js';\n/m,'').replaceAll('export async function','async function').replaceAll('export function','function').replaceAll('export const','const').replaceAll('export class','class');
let code=fs.readFileSync('worker/index.js','utf8')
  .replace("import {assets} from './assets.js';",'const assets='+JSON.stringify(assets)+';')
  .replace("import {isAdmin, authRoute} from './auth.js';",inline('worker/auth.js'))
  .replace("import {HttpError, readBytes, readJson, json, escapeHtml, secureResponse} from './http.js';",inline('worker/http.js'));
fs.mkdirSync('dist/server',{recursive:true});
fs.writeFileSync('dist/server/index.js',code);
console.log('Built Worker with '+Object.keys(assets).length+' public assets.');
