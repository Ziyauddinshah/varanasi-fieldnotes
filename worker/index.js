import {assets} from './assets.js';
import {isAdmin, authRoute} from './auth.js';
import {HttpError, readBytes, readJson, json, escapeHtml, secureResponse} from './http.js';
const validId = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const visible = post => post.status === 'published' && (!post.expires || post.expires >= new Date().toISOString().slice(0,10));
function text(data,key,max) {
  const value = data[key] ?? '';
  if (typeof value !== 'string' || value.length > max) throw new HttpError(400,'Invalid '+key+' (maximum '+max+' characters)');
  return value.trim();
}
function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value; }
function safeLink(value) { try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; } }
async function allPosts(env) {
  const posts = []; let cursor;
  do {
    const list = await env.BUCKET.list({prefix:'posts/',cursor});
    for (let i=0;i<list.objects.length;i+=8) {
      const group = await Promise.all(list.objects.slice(i,i+8).map(async item => {
        const object = await env.BUCKET.get(item.key); return object ? object.json() : null;
      }));
      posts.push(...group.filter(Boolean));
    }
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
  return posts.sort((a,b)=>b.updated.localeCompare(a.updated));
}
const page = (content,status=200) => new Response(content,{status,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
const notFound = () => page('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Page not found — Varanasi Fieldnotes</title><link rel="stylesheet" href="/style.css"><main class="article-page"><h1>That page has moved.</h1><p>The story may be unpublished or the link may be incorrect.</p><a class="button green" href="/">Return to the journal ↗</a></main></html>',404);
function articlePage(post,origin) {
  const esc = escapeHtml, url = origin+'/journal/'+post.id, description = post.excerpt || post.body.slice(0,160);
  const image = post.image ? '<img class="article-cover" src="'+esc(post.image)+'" alt="'+esc(post.alt)+'">' : '';
  return page('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(post.title)+' — Varanasi Fieldnotes</title><meta name="description" content="'+esc(description)+'"><link rel="canonical" href="'+esc(url)+'"><meta property="og:type" content="article"><meta property="og:title" content="'+esc(post.title)+'"><meta property="og:description" content="'+esc(description)+'"><meta property="og:url" content="'+esc(url)+'">'+(post.image?'<meta property="og:image" content="'+esc(origin+post.image)+'">':'')+'<link rel="stylesheet" href="/style.css"></head><body><header><a class="brand" href="/">varanasi<span>FIELDNOTES</span></a><a href="/#latest">← All stories</a></header><main class="article-page"><article><p class="eyebrow">'+esc(post.category)+'</p><h1>'+esc(post.title)+'</h1><p class="meta">Updated '+esc(post.updated.slice(0,10))+'</p>'+image+post.body.split(/\n\s*\n/).map(p=>'<p>'+esc(p)+'</p>').join('')+(post.expires?'<p>Valid through '+esc(post.expires)+' (UTC). See the article for terms.</p>':'')+(post.link&&safeLink(post.link)?'<a class="button green" target="_blank" rel="noopener noreferrer" href="'+esc(post.link)+'">More information ↗</a>':'')+'</article><a class="text-link" href="/#itinerary">Plan your visit ↗</a></main></body></html>');
}
async function route(request,env) {
  const u = new URL(request.url), path = u.pathname;
  if (['/api/auth/login','/api/auth/logout','/api/auth/password'].includes(path)) return authRoute(request,env,path);
  if (path === '/admin.html') return Response.redirect(u.origin+'/admin',302);
  if (path === '/login.html' || path === '/admin/') return Response.redirect(u.origin+(path==='/login.html'?'/admin/login':'/admin'),302);
  const protectedPath = path === '/admin' || path.startsWith('/api/admin/');
  const authorized = protectedPath || path === '/api/me' ? await isAdmin(request,env) : false;
  if (path === '/api/me') return json({admin:authorized});
  if (path === '/admin' && !authorized) return Response.redirect(u.origin+'/admin/login',302);
  if (path.startsWith('/api/admin/')) {
    if (!authorized) return json({error:'Admin login required'},403);
    if (request.method !== 'GET' && request.headers.get('Origin') !== u.origin) return json({error:'Invalid request origin'},403);
  }
  if (path === '/api/posts' || path === '/api/admin/posts') {
    if (request.method === 'GET') {
      const posts = await allPosts(env);
      return json(path.includes('/admin/') ? posts : posts.filter(visible).map(({body,...p})=>({...p,excerpt:p.excerpt||body.slice(0,160)+'…'})));
    }
  }
  if (path === '/api/admin/export' && request.method === 'GET') return json({formatVersion:1,exportedAt:new Date().toISOString(),posts:await allPosts(env)},200,{'Content-Disposition':'attachment; filename="varanasi-articles-'+new Date().toISOString().slice(0,10)+'.json"'});
  if (path === '/healthz' && request.method === 'GET') return json({status:'ok'});
  if (path === '/robots.txt' && request.method === 'GET') return new Response('User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nSitemap: '+u.origin+'/sitemap.xml\n',{headers:{'Content-Type':'text/plain; charset=utf-8'}});
  if (path === '/sitemap.xml' && request.method === 'GET') {
    const posts = (await allPosts(env)).filter(visible);
    return new Response('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>'+escapeHtml(u.origin)+'/</loc></url>'+posts.map(p=>'<url><loc>'+escapeHtml(u.origin+'/journal/'+p.id)+'</loc><lastmod>'+escapeHtml(p.updated)+'</lastmod></url>').join('')+'</urlset>',{headers:{'Content-Type':'application/xml; charset=utf-8','Cache-Control':'no-store'}});
  }
  if (path.startsWith('/journal/') && request.method === 'GET') {
    const id = path.slice(9); if (!validId(id)) return notFound();
    const object = await env.BUCKET.get('posts/'+id+'.json'); if (!object) return notFound();
    const post = await object.json(); return visible(post) ? articlePage(post,u.origin) : notFound();
  }
  if (path === '/api/admin/upload' && request.method === 'POST') {
    const bytes = await readBytes(request,5*1024*1024);
    let type;
    if (bytes.length>=4 && bytes[0]===255 && bytes[1]===216 && bytes[2]===255) type='image/jpeg';
    if (bytes.length>=24 && [137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v)) type='image/png';
    if (bytes.length>=16 && String.fromCharCode(...bytes.slice(0,4))==='RIFF' && String.fromCharCode(...bytes.slice(8,12))==='WEBP') type='image/webp';
    if (!type) return json({error:'Use a JPEG, PNG or WebP image'},400);
    const id = crypto.randomUUID(); await env.BUCKET.put('images/'+id,bytes,{httpMetadata:{contentType:type}});
    return json({url:'/media/'+id},201);
  }
  if (path.startsWith('/media/') && request.method === 'GET') {
    const id = path.slice(7); if (!validId(id)) return notFound();
    const object = await env.BUCKET.get('images/'+id); if (!object) return notFound();
    return new Response(object.body,{headers:{'Content-Type':object.httpMetadata.contentType,'Cache-Control':'public,max-age=31536000,immutable'}});
  }
  if (path === '/api/admin/posts' && request.method === 'POST') {
    const data = await readJson(request); const id = data.id || crypto.randomUUID();
    if (!validId(id)) return json({error:'Invalid article'},400);
    let existing, existingEtag;
    if (data.id) {
      const object = await env.BUCKET.get('posts/'+id+'.json');
      if (!object) return json({error:'Article no longer exists'},404);
      existingEtag = object.etag; existing = await object.json();
      if (data.updated !== existing.updated) return json({error:'This post changed in another session. Reload it before saving.'},409);
    }
    const category = text(data,'category',30) || 'Culture', status = text(data,'status',20) || 'draft';
    if (!['Culture','Food','Slow travel','Offer','Travel update'].includes(category) || !['draft','published'].includes(status)) return json({error:'Invalid category or status'},400);
    const now = new Date(Math.max(Date.now(), existing ? Date.parse(existing.updated)+1 : 0)).toISOString();
    const p = {id,title:text(data,'title',180),excerpt:text(data,'excerpt',350),body:text(data,'body',30000),category,status,image:text(data,'image',120),alt:text(data,'alt',250),expires:text(data,'expires',10),link:text(data,'link',2000),created:existing?.created||existing?.updated||now,updated:now};
    if (!p.title || !p.body) return json({error:'Add a title and article text'},400);
    if (p.image && (!p.image.startsWith('/media/') || !validId(p.image.slice(7)) || !await env.BUCKET.head('images/'+p.image.slice(7)))) return json({error:'Upload an image using the dashboard'},400);
    if (p.image && !p.alt) return json({error:'Describe the image for accessibility'},400);
    if (p.expires && !validDate(p.expires)) return json({error:'Invalid expiry date'},400);
    if (p.link && !safeLink(p.link)) return json({error:'Offer links must start with https:// and contain no embedded credentials'},400);
    const written = await env.BUCKET.put('posts/'+id+'.json',JSON.stringify(p),{httpMetadata:{contentType:'application/json'},...(existingEtag?{onlyIf:{etagMatches:existingEtag}}:{})});
    if (written === null) return json({error:'This post changed while you were saving. Reload it and try again.'},409);
    return json(p);
  }
  if (path.startsWith('/api/admin/posts/') && request.method === 'DELETE') {
    const id = path.split('/').pop(); if (!validId(id)) return json({error:'Invalid article'},400);
    const object = await env.BUCKET.get('posts/'+id+'.json'); if (!object) return json({error:'Article no longer exists'},404);
    const version = request.headers.get('If-Match');
    if (!version || version !== '"'+(await object.json()).updated+'"') return json({error:'This post changed. Reload it before deleting.'},409);
    await env.BUCKET.delete('posts/'+id+'.json'); return json({ok:true});
  }
  if (path.startsWith('/api/')) return json({error:'Not found or method not allowed'},404);
  if (!['GET','HEAD'].includes(request.method)) return new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD'}});
  const asset = assets[path==='/admin/login'?'/login.html':path==='/admin'?'/admin.html':path==='/'?'/index.html':path];
  if (!asset) return notFound();
  return new Response(request.method==='HEAD'?null:Uint8Array.from(atob(asset.body),c=>c.charCodeAt(0)),{headers:{'Content-Type':asset.type,'Cache-Control':path.startsWith('/admin')?'no-store':'public,max-age=60'}});
}
export async function handle(request,env) {
  try {
    let response = await route(request.method === 'HEAD' ? new Request(request,{method:'GET'}) : request,env);
    if (request.method === 'HEAD') response = new Response(null,{status:response.status,headers:response.headers});
    return secureResponse(response,new URL(request.url).pathname);
  }
  catch (error) {
    if (!(error instanceof HttpError)) console.error('Request failed',error.message);
    return secureResponse(json({error:error instanceof HttpError?error.message:'Unable to complete the request. Please try again.'},error instanceof HttpError?error.status:500),new URL(request.url).pathname);
  }
}
export default {fetch:handle};
