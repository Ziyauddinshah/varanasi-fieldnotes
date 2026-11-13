import {assets} from './assets.js';
import {isAdmin,authRoute} from './auth.js';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const validId=s=>/^[0-9a-f-]{36}$/.test(s);
const txt=(v,n)=>typeof v==='string'?v.trim().slice(0,n):'';
export async function handle(request,env){
 const u=new URL(request.url),path=u.pathname;
 if(path==='/api/auth/login'||path==='/api/auth/logout')return authRoute(request,env,path);
 const authorized=(path==='/api/me'||path==='/admin'||path.startsWith('/api/admin/'))?await isAdmin(request,env):false;
 if(path==='/api/me')return json({admin:authorized});
 if(path==='/admin'&&!authorized)return Response.redirect(u.origin+'/admin/login',302);
 if(path.startsWith('/api/admin/')){
  if(!authorized)return json({error:'Admin login required'},403);
  if(request.method!=='GET'&&request.headers.get('Origin')!==u.origin)return json({error:'Invalid request origin'},403);
 }
 if(path==='/api/posts'||path==='/api/admin/posts'){
  if(request.method==='GET'){
   const items=[];let cursor;
   do{const list=await env.BUCKET.list({prefix:'posts/',cursor});for(const item of list.objects){const o=await env.BUCKET.get(item.key);if(o){const p=await o.json();if(path.includes('/admin/')||p.status==='published'&&(!p.expires||p.expires>=new Date().toISOString().slice(0,10)))items.push(p)}}cursor=list.truncated?list.cursor:undefined}while(cursor);
   return json(items.sort((a,b)=>b.updated.localeCompare(a.updated)));
  }
 }
 if(path==='/api/admin/upload'&&request.method==='POST'){
  if(Number(request.headers.get('content-length')||0)>5*1024*1024)return json({error:'Maximum image size is 5 MB'},413);
  const bytes=new Uint8Array(await request.arrayBuffer());if(!bytes.length||bytes.length>5*1024*1024)return json({error:'Choose an image under 5 MB'},413);
  let type=bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71?'image/png':String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP'?'image/webp':null;
  if(!type)return json({error:'Use a JPEG, PNG or WebP image'},400);
  const id=crypto.randomUUID();await env.BUCKET.put('images/'+id,bytes,{httpMetadata:{contentType:type}});return json({url:'/media/'+id},201);
 }
 if(path.startsWith('/media/')&&request.method==='GET'){
  const id=path.slice(7);if(!validId(id))return json({error:'Not found'},404);const o=await env.BUCKET.get('images/'+id);if(!o)return json({error:'Not found'},404);return new Response(o.body,{headers:{'Content-Type':o.httpMetadata.contentType,'Cache-Control':'public,max-age=31536000,immutable','X-Content-Type-Options':'nosniff'}});
 }
 if(path==='/api/admin/posts'&&request.method==='POST'){
  if(Number(request.headers.get('content-length')||0)>100000)return json({error:'Article is too long'},413);
  const data=await request.json();const id=data.id||crypto.randomUUID();if(!validId(id))return json({error:'Invalid article'},400);
  if(data.id&&!await env.BUCKET.head('posts/'+id+'.json'))return json({error:'Article no longer exists'},404);
  const p={id,title:txt(data.title,180),excerpt:txt(data.excerpt,350),body:txt(data.body,30000),category:['Culture','Food','Slow travel','Offer','Travel update'].includes(data.category)?data.category:'Culture',status:data.status==='published'?'published':'draft',image:txt(data.image,120),alt:txt(data.alt,250),expires:txt(data.expires,10),link:txt(data.link,2000),updated:new Date().toISOString()};
  if(!p.title||!p.body)return json({error:'Add a title and article text'},400);
  if(p.image&&!/^\/media\/[0-9a-f-]{36}$/.test(p.image))return json({error:'Upload an image using the dashboard'},400);
  if(p.image&&!p.alt)return json({error:'Describe the image for accessibility'},400);
  if(p.expires&&!/^\d{4}-\d{2}-\d{2}$/.test(p.expires))return json({error:'Invalid expiry date'},400);
  if(p.link){try{if(new URL(p.link).protocol!=='https:')throw Error()}catch{return json({error:'Offer links must start with https://'},400)}}
  await env.BUCKET.put('posts/'+id+'.json',JSON.stringify(p),{httpMetadata:{contentType:'application/json'}});return json(p);
 }
 if(path.startsWith('/api/admin/posts/')&&request.method==='DELETE'){
  const id=path.split('/').pop();if(!validId(id))return json({error:'Invalid article'},400);await env.BUCKET.delete('posts/'+id+'.json');return json({ok:true});
 }
 if(path.startsWith('/api/'))return json({error:'Not found'},404);
 const asset=assets[path==='/admin/login'?'/login.html':path==='/admin'?'/admin.html':path==='/'?'/index.html':path];
 if(!asset)return new Response('Page not found',{status:404});
 const bytes=Uint8Array.from(atob(asset.body),c=>c.charCodeAt(0));return new Response(bytes,{headers:{'Content-Type':asset.type,'Cache-Control':path.startsWith('/admin')?'no-store':'public,max-age=60','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' blob:; base-uri 'none'; frame-ancestors 'self' https://chatgpt.com"}});
}
export default {async fetch(request,env){try{return await handle(request,env)}catch(e){console.error('Request failed',e.message);return json({error:'Unable to complete the request. Please try again.'},500)}}};
