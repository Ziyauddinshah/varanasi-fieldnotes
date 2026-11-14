import {HttpError, readJson, json} from './http.js';
const encoder = new TextEncoder();
const hex = bytes => Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2,'0')).join('');
const sessionCookie = token => '__Host-admin_session='+token+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age='+(token?'28800':'0');
const sessionToken = request => request.headers.get('Cookie')?.match(/(?:^|;\s*)__Host-admin_session=([a-f0-9]{64})(?:;|$)/)?.[1];
export async function hash(value) { return hex(await crypto.subtle.digest('SHA-256', encoder.encode(value))); }
export async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:encoder.encode(salt),iterations:100000}, key, 256));
}
async function credential(env) {
  const stored = await env.BUCKET.get('auth/credentials');
  return stored ? (await stored.json()).passwordHash : env.ADMIN_PASSWORD_HASH;
}
async function verifyPassword(password, config) {
  const [salt, expected] = (config || '').split(':');
  if (!salt || !/^[a-f0-9]{64}$/.test(expected || '')) throw new HttpError(503, 'Admin login is not configured');
  const actual = await passwordHash(typeof password === 'string' ? password : '', salt);
  let diff = actual.length ^ expected.length;
  for (let i=0; i<expected.length; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
export async function isAdmin(request, env) {
  // These identity headers are trusted only behind Sites dispatch.
  if (request.headers.get('oai-authenticated-user-id') && request.headers.get('oai-authenticated-user-email')?.toLowerCase() === 'abhi1590jeet@gmail.com') return true;
  const token = sessionToken(request); if (!token) return false;
  const key = 'auth/sessions/'+await hash(token), record = await env.BUCKET.get(key);
  if (!record) return false;
  const session = await record.json();
  if (session.expires <= Date.now()) { await env.BUCKET.delete(key); return false; }
  return session.version === await hash(await credential(env) || '');
}
export async function authRoute(request, env, path) {
  if (request.method !== 'POST') return json({error:'Method not allowed'},405,{'Allow':'POST'});
  if (request.headers.get('Origin') !== new URL(request.url).origin) return json({error:'Invalid request origin'},403);
  if (path === '/api/auth/logout') {
    const token = sessionToken(request);
    if (token) await env.BUCKET.delete('auth/sessions/'+await hash(token));
    return json({ok:true},200,{'Set-Cookie':sessionCookie('')});
  }
  if (path === '/api/auth/password') {
    if (!await isAdmin(request,env)) return json({error:'Admin login required'},403);
    const data = await readJson(request,2000);
    if (typeof data.newPassword !== 'string' || data.newPassword.length < 14 || data.newPassword.length > 128) return json({error:'Use a new password between 14 and 128 characters'},400);
    if (!await verifyPassword(data.currentPassword,await credential(env))) return json({error:'Current password is incorrect'},401);
    if (data.newPassword === data.currentPassword) return json({error:'Choose a different password'},400);
    const salt = hex(crypto.getRandomValues(new Uint8Array(24)));
    await env.BUCKET.put('auth/credentials',JSON.stringify({passwordHash:salt+':'+await passwordHash(data.newPassword,salt),updated:new Date().toISOString()}));
    return json({ok:true},200,{'Set-Cookie':sessionCookie('')});
  }
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rateKey = 'auth/attempts/'+await hash(ip), record = await env.BUCKET.get(rateKey);
  let rate = record ? await record.json() : {count:0,start:Date.now()};
  if (Date.now()-rate.start > 900000) rate = {count:0,start:Date.now()};
  if (rate.count >= 10) return json({error:'Too many attempts. Please try again in 15 minutes.'},429,{'Retry-After':String(Math.max(1,Math.ceil((rate.start+900000-Date.now())/1000)))});
  const data = await readJson(request,2000);
  // Reserve an attempt before doing expensive password verification.
  await env.BUCKET.put(rateKey,JSON.stringify({count:rate.count+1,start:rate.start}));
  const config = await credential(env), correct = await verifyPassword(data.password,config);
  if (data.username !== 'Admin' || !correct) return json({error:'Incorrect user ID or password'},401);
  await env.BUCKET.delete(rateKey);
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  await env.BUCKET.put('auth/sessions/'+await hash(token),JSON.stringify({expires:Date.now()+28800000,version:await hash(config)}));
  return json({ok:true},200,{'Set-Cookie':sessionCookie(token)});
}
