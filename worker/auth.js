const encoder=new TextEncoder();
const hex=b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
export async function hash(v){return hex(await crypto.subtle.digest('SHA-256',encoder.encode(v)))}
export async function passwordHash(password,salt){const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);return hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:encoder.encode(salt),iterations:100000},key,256))}
export async function isAdmin(request,env){
 if(request.headers.get('oai-authenticated-user-id')&&request.headers.get('oai-authenticated-user-email')?.toLowerCase()==='abhi1590jeet@gmail.com')return true;
 const token=request.headers.get('Cookie')?.match(/(?:^|;\s*)__Host-admin_session=([a-f0-9]{64})(?:;|$)/)?.[1];if(!token)return false;
 const record=await env.BUCKET.get('auth/sessions/'+await hash(token));if(!record)return false;const session=await record.json();return session.expires>Date.now();
}
export async function authRoute(request,env,path){
 const origin=new URL(request.url).origin;
 const out=(data,status=200,cookie)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store',...(cookie?{'Set-Cookie':cookie}:{})}});
 if(request.method!=='POST')return out({error:'Method not allowed'},405);
 if(request.headers.get('Origin')!==origin)return out({error:'Invalid request origin'},403);
 if(path==='/api/auth/logout'){
  const token=request.headers.get('Cookie')?.match(/(?:^|;\s*)__Host-admin_session=([a-f0-9]{64})(?:;|$)/)?.[1];if(token)await env.BUCKET.delete('auth/sessions/'+await hash(token));return out({ok:true},200,'__Host-admin_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0');
 }
 const ip=request.headers.get('CF-Connecting-IP')||'unknown';const rateKey='auth/attempts/'+await hash(ip);const rateObject=await env.BUCKET.get(rateKey);let rate=rateObject?await rateObject.json():{count:0,start:Date.now()};if(Date.now()-rate.start>900000)rate={count:0,start:Date.now()};if(rate.count>=10)return out({error:'Too many attempts. Please try again in 15 minutes.'},429);
 const raw=await request.text();if(raw.length>1000)return out({error:'Invalid login'},400);let data;try{data=JSON.parse(raw)}catch{return out({error:'Invalid login'},400)}
 const [salt,expected]=(env.ADMIN_PASSWORD_HASH||'').split(':');if(!salt||!expected)return out({error:'Admin login is not configured'},503);
 const actual=await passwordHash(typeof data.password==='string'?data.password:'',salt);let diff=actual.length^expected.length;for(let i=0;i<expected.length;i++)diff|=actual.charCodeAt(i)^expected.charCodeAt(i);
 if(data.username!=='Admin'||diff!==0){await env.BUCKET.put(rateKey,JSON.stringify({count:rate.count+1,start:rate.start}));return out({error:'Incorrect user ID or password'},401)}
 await env.BUCKET.delete(rateKey);const token=hex(crypto.getRandomValues(new Uint8Array(32)));await env.BUCKET.put('auth/sessions/'+await hash(token),JSON.stringify({expires:Date.now()+28800000}));return out({ok:true},200,'__Host-admin_session='+token+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800');
}
