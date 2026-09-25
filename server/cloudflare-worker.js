// Cloudflare Worker + D1 API for Kheitai Membership V21.
// Bind a D1 database as DB and set TOKEN_SECRET (32+ chars) as a secret.
const enc = new TextEncoder();
const dec = new TextDecoder();
const json = (d, s=200, origin='*') => new Response(JSON.stringify(d), { status:s, headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':origin,'access-control-allow-headers':'Content-Type, Authorization','access-control-allow-methods':'GET, POST, PATCH, DELETE, OPTIONS','vary':'Origin'} });
const b64 = a => btoa(String.fromCharCode(...new Uint8Array(a))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const unb64 = s => Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/') + '='.repeat((4-s.length%4)%4)), c=>c.charCodeAt(0));
const now = () => new Date().toISOString();
function expiry(v) { if (v === undefined || v === null || v === '') return null; const d = new Date(String(v)); if (isNaN(d)) throw Error('วันหมดอายุไม่ถูกต้อง'); return d.toISOString(); }
function expired(u) { return u.expires_at && Date.parse(u.expires_at) <= Date.now(); }
async function derive(password, salt) { const k=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']); return new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt:enc.encode(salt),iterations:210000,hash:'SHA-256'},k,256)); }
async function hash(password) { const salt=b64(crypto.getRandomValues(new Uint8Array(16))); return {salt, hash:b64(await derive(password,salt))}; }
function same(a,b) { if(a.length!==b.length)return false; let x=0; for(let i=0;i<a.length;i++)x|=a[i]^b[i]; return x===0; }
async function check(password,u) { return same(await derive(password,u.password_salt),unb64(u.password_hash)); }
async function sign(payload,secret) { const k=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']); return b64(await crypto.subtle.sign('HMAC',k,enc.encode(payload))); }
async function token(u,secret) { const p=b64(enc.encode(JSON.stringify({sub:u.id,role:u.role,pv:u.password_version,exp:Date.now()+43200000}))); return p+'.'+await sign(p,secret); }
function pub(u) { return {id:u.id,role:u.role,active:!!u.active,createdAt:u.created_at,expiresAt:u.expires_at||null}; }
async function auth(req,env) { const raw=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,''); const [p,s]=raw.split('.'); if(!p||!s)return null; if(!same(unb64(s),unb64(await sign(p,env.TOKEN_SECRET))))return null; try { const x=JSON.parse(dec.decode(unb64(p))); if(x.exp<Date.now())return null; const u=await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(x.sub).first(); return u&&u.active&&!expired(u)&&u.password_version===x.pv?u:null; } catch { return null; } }
async function body(req) { try{return await req.json()}catch{throw Error('INVALID_JSON')} }
export default { async fetch(req,env) {
  const origin=env.CORS_ORIGIN||'*'; if(req.method==='OPTIONS')return new Response(null,{status:204,headers:{'access-control-allow-origin':origin,'access-control-allow-headers':'Content-Type, Authorization','access-control-allow-methods':'GET, POST, PATCH, DELETE, OPTIONS'}});
  if(!env.TOKEN_SECRET||env.TOKEN_SECRET.length<32)return json({error:'เซิร์ฟเวอร์ยังไม่ได้ตั้ง TOKEN_SECRET'},500,origin);
  const u=new URL(req.url); let p=u.pathname.replace(/^\/api(?=\/)/,'');
  try {
    if(req.method==='GET'&&p==='/health')return json({ok:true,service:'Kheitai Membership API',time:now()},200,origin);
    if(req.method==='POST'&&p==='/login'){const b=await body(req), id=String(b.id||'').trim(), pw=String(b.password||''); const x=await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(id).first(); if(!x||!x.active||expired(x)||!(await check(pw,x)))return json({error:'ไอดีหรือรหัสผ่านไม่ถูกต้อง หรือสมาชิกหมดอายุ/ถูกปิดใช้งาน'},401,origin); return json({token:await token(x,env.TOKEN_SECRET),user:pub(x)},200,origin);}
    const user=await auth(req,env); if(!user)return json({error:'เซสชันหมดอายุหรือสมาชิกถูกปิดใช้งาน กรุณาเข้าสู่ระบบใหม่'},401,origin);
    if(req.method==='GET'&&p==='/me')return json({user:pub(user)},200,origin); if(user.role!=='admin')return json({error:'เฉพาะ AdminGod เท่านั้นที่จัดการสมาชิกได้'},403,origin);
    if(req.method==='GET'&&p==='/admin/members'){const r=await env.DB.prepare("SELECT * FROM users WHERE role!='admin' ORDER BY created_at DESC").all();return json({members:r.results.map(pub)},200,origin);}
    if(req.method==='POST'&&p==='/admin/members'){const b=await body(req),id=String(b.id||'').trim(),pw=String(b.password||'');if(!/^[A-Za-z0-9_.-]{3,40}$/.test(id)||pw.length<8||pw.length>200)return json({error:'ไอดีหรือรหัสผ่านไม่ถูกต้อง'},400,origin);const ex=expiry(b.expiresAt);if(ex&&Date.parse(ex)<=Date.now())return json({error:'วันหมดอายุต้องเป็นอนาคต'},400,origin);if(await env.DB.prepare('SELECT 1 FROM users WHERE lower(id)=lower(?)').bind(id).first())return json({error:'ไอดีนี้มีอยู่แล้ว'},409,origin);const h=await hash(pw);await env.DB.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)').bind(id,h.hash,h.salt,'member',now(),ex,1,1).run();return json({ok:true},201,origin);}
    const m=p.match(/^\/admin\/members\/([^/]+)$/); if(m){const id=decodeURIComponent(m[1]),x=await env.DB.prepare("SELECT * FROM users WHERE id=? AND role!='admin'").bind(id).first();if(!x)return json({error:'ไม่พบบัญชีนี้'},404,origin);if(req.method==='DELETE'){await env.DB.prepare('DELETE FROM users WHERE id=?').bind(id).run();return json({ok:true},200,origin);}if(req.method==='PATCH'){const b=await body(req), sets=[], vals=[];if(b.password!==undefined){if(String(b.password).length<8)return json({error:'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร'},400,origin);const h=await hash(String(b.password));sets.push('password_hash=?','password_salt=?','password_version=password_version+1');vals.push(h.hash,h.salt);}if(b.active!==undefined){sets.push('active=?');vals.push(b.active?1:0);}if(b.expiresAt!==undefined){sets.push('expires_at=?');vals.push(expiry(b.expiresAt));}if(!sets.length)return json({error:'ไม่มีข้อมูลสำหรับแก้ไข'},400,origin);await env.DB.prepare(`UPDATE users SET ${sets.join(',')} WHERE id=?`).bind(...vals,id).run();return json({ok:true},200,origin);}}
    return json({error:'ไม่พบ endpoint'},404,origin);
  } catch(e) { return json({error:e.message||'คำขอไม่ถูกต้อง'},400,origin); }
} };
