import fs from 'node:fs';
import assert from 'node:assert/strict';
import {pbkdf2Sync} from 'node:crypto';
const {handle}=await import('data:text/javascript;base64,'+fs.readFileSync('dist/server/index.js').toString('base64'));
const data=new Map();let version=0;
const bucket={
  async put(key,body,options={}) { if(options.onlyIf?.etagMatches && data.get(key)?.etag!==options.onlyIf.etagMatches)return null;const result={body,options,etag:String(++version)};data.set(key,result);return result; },
  async get(key) {const item=data.get(key);return item?{json:async()=>JSON.parse(item.body),body:item.body,etag:item.etag,httpMetadata:item.options.httpMetadata}:null;},
  async head(key) {return data.has(key)?{etag:data.get(key).etag}:null;},
  async list({prefix}) {return {objects:[...data.keys()].filter(key=>key.startsWith(prefix)).map(key=>({key})),truncated:false};},
  async delete(key) {data.delete(key);}
};
const env={BUCKET:bucket,ADMIN_PASSWORD_HASH:'fixture-salt:'+pbkdf2Sync('Original-test-password','fixture-salt',100000,32,'sha256').toString('hex')};
const origin='https://test.example', owner={'oai-authenticated-user-id':'trusted-site-owner','oai-authenticated-user-email':'abhi1590jeet@gmail.com',Origin:origin};
const call=(path,method='GET',body,headers=owner)=>handle(new Request(origin+path,{method,headers,...(body!==undefined?{body:typeof body==='string'?body:JSON.stringify(body)}:{})}),env);
for(const payload of ['{', 'null', '[]', '"not an object"'])assert.equal((await call('/api/admin/posts','POST',payload)).status,400);
assert.equal((await call('/api/admin/posts','POST',{title:'x'.repeat(181),body:'content'})).status,400);
assert.equal((await call('/api/admin/posts','POST',{title:'x',body:'content',expires:'2026-02-30'})).status,400);
assert.equal((await call('/api/admin/posts','POST',{title:'x',body:'content',link:'https://user:password@example.com'})).status,400);
assert.equal((await call('/api/admin/posts','POST',{title:'x',body:'content',image:'/media/'+crypto.randomUUID(),alt:'Missing file'})).status,400);
const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(100001));controller.close();}});
assert.equal((await handle(new Request(origin+'/api/admin/posts',{method:'POST',headers:owner,body:stream,duplex:'half'}),env)).status,413);
const save=async body=>{const response=await call('/api/admin/posts','POST',body);assert.equal(response.status,200);return response.json();};
const draft=await save({title:'Secret draft',body:'Not public',status:'draft'});
assert.equal((await call('/journal/'+draft.id,'GET',undefined,{})).status,404);
const article=await save({title:'A <script> & "story"',body:'<script>alert(1)</script>\n\nA useful second paragraph',status:'published'});
const page=await call('/journal/'+article.id,'GET',undefined,{});assert.equal(page.status,200);const html=await page.text();assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>alert(1)</script>'));assert.ok(html.includes('rel="canonical"'));
const sitemap=await (await call('/sitemap.xml','GET',undefined,{})).text();assert.ok(sitemap.includes(article.id));assert.ok(!sitemap.includes(draft.id));
const publicPosts=await (await call('/api/posts','GET',undefined,{})).json();assert.equal(publicPosts.length,1);assert.ok(!('body' in publicPosts[0]));
await save({...article,title:'Edited'});assert.equal((await call('/api/admin/posts','POST',{...article,title:'Stale edit'})).status,409);
assert.equal((await call('/api/admin/posts/'+article.id,'DELETE',undefined,{...owner,'If-Match':'"'+article.updated+'"'})).status,409);
const exported=await call('/api/admin/export');assert.equal((await exported.json()).posts.length,2);assert.match(exported.headers.get('Content-Disposition'),/attachment/);assert.equal((await call('/api/admin/export','GET',undefined,{})).status,403);
for(const path of ['/','/admin/login','/api/posts','/healthz','/not-found','/api/admin/posts']){const response=await call(path,'GET',undefined,{});assert.match(response.headers.get('Content-Security-Policy'),/form-action 'self'/);assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');}
assert.equal((await call('/admin.html','GET',undefined,{})).headers.get('location'),origin+'/admin');assert.equal((await call('/admin','GET',undefined,{})).status,302);
assert.equal((await call('/admin/login','GET',undefined,{})).headers.get('Cache-Control'),'no-store');
assert.equal((await call('/style.css','POST','',{})).status,405);
const login=async password=>call('/api/auth/login','POST',{username:'Admin',password},{Origin:origin,'CF-Connecting-IP':'127.0.0.2'});
const signed=await login('Original-test-password');assert.equal(signed.status,200);const cookie=signed.headers.get('Set-Cookie').split(';')[0],sessionHeaders={Origin:origin,Cookie:cookie};
assert.equal((await call('/api/auth/password','POST',{currentPassword:'Original-test-password',newPassword:'short'},sessionHeaders)).status,400);
assert.equal((await call('/api/auth/password','POST',{currentPassword:'wrong',newPassword:'Replacement-test-password'},sessionHeaders)).status,401);
assert.equal((await call('/api/auth/password','POST',{currentPassword:'Original-test-password',newPassword:'Replacement-test-password'},sessionHeaders)).status,200);
assert.equal((await call('/api/admin/posts','GET',undefined,sessionHeaders)).status,403);
assert.equal((await login('Original-test-password')).status,401);assert.equal((await login('Replacement-test-password')).status,200);
assert.equal((await call('/api/auth/login','POST','null',{Origin:origin})).status,400);
console.log('Passed production regression checks: bounded request bodies, malformed JSON, field validation, missing uploads, private drafts, escaped article pages, sitemap, stale edits/deletes, protected export, response headers, password rotation and session revocation.');
