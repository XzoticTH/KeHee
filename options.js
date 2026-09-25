const defaults = {1:'',2:'',3:'',4:''};
const $ = id => document.getElementById(id);
const LOCAL_ADMIN_ID = 'Admingod';
const LOCAL_ADMIN_PASSWORD = '445566';
const API_BASE = 'https://ke-hee.vercel.app/api';
let currentUser = null;
function showStatus(msg, good=false){ const el=$('status'); el.textContent=msg; el.style.color=good?'#087d55':'#b42318'; }
function memberStatus(msg, good=false){ const el=$('memberStatus'); el.textContent=msg; el.style.color=good?'#087d55':'#b42318'; }
function escapeText(v){ return String(v ?? ''); }
function formatDate(v){ if(!v) return 'ไม่หมดอายุ'; const d=new Date(v); return Number.isNaN(d.getTime())?'ไม่ทราบ':d.toLocaleDateString('th-TH',{year:'numeric',month:'2-digit',day:'2-digit'}); }
function expiryInputValue(v){ if(!v) return ''; const d=new Date(v); if(Number.isNaN(d.getTime())) return ''; return d.toISOString().slice(0,10); }
function render(replies){
  const rows=$('rows'); rows.innerHTML='';
  for(let i=1;i<=4;i++){
    const wrap=document.createElement('div'); wrap.className='reply-card';
    const head=document.createElement('div'); head.className='reply-head';
    const key=document.createElement('div'); key.className='key'; key.textContent=String(i);
    const copy=document.createElement('div'); copy.className='key-copy';
    const strong=document.createElement('strong'); strong.textContent=`ข้อความ ${i}`;
    const span=document.createElement('span'); span.textContent='ข้อความตอบกลับด่วน'; copy.append(strong,span); head.append(key,copy);
    const ta=document.createElement('textarea'); ta.id=`r${i}`; ta.rows=3; ta.placeholder='พิมพ์ข้อความตอบกลับ...'; ta.value=replies[i]||'';
    const btn=document.createElement('button'); btn.className='insert'; btn.dataset.i=String(i); btn.textContent='ใส่ข้อความในแชต'; btn.addEventListener('click',()=>insertReply(i));
    wrap.append(head,ta,btn); rows.appendChild(wrap);
  }
}
async function load(){
  const r=await chrome.storage.local.get(['replies','calcEnabled']);
  render({...defaults,...(r.replies||{})}); $('calcToggle').checked=!!r.calcEnabled; updateCalcPreview();
}
async function getTab(){ const [tab]=await chrome.tabs.query({active:true,currentWindow:true}); return tab; }
async function getSession(){ return await chrome.storage.session.get({token:'',user:null}); }
function normalizeBase(v){ return String(v||'').trim().replace(/\/$/,''); }
function validateApiUrl(value){
  let u; try{u=new URL(value);}catch(_){throw new Error('API URL ไม่ถูกต้อง');}
  const local=u.hostname==='localhost'||u.hostname==='127.0.0.1';
  if(u.protocol!=='https:' && !local) throw new Error('ระบบจริงต้องใช้ HTTPS');
  if(u.username||u.password) throw new Error('API URL ห้ามมี username/password');
  return u;
}
async function api(path, options={}){
  const s=await getSession(); const base=API_BASE;
  const headers={'Content-Type':'application/json',...(options.headers||{})}; if(s.token) headers.Authorization='Bearer '+s.token;
  let response;
  try{ response=await fetch(base+path,{...options,headers,cache:'no-store'}); }catch(e){ throw new Error('เชื่อมต่อ API ไม่สำเร็จ: '+(e?.message||e)); }
  let data={}; try{data=await response.json()}catch(_){ }
  if(!response.ok) throw new Error(data.error||`HTTP ${response.status}`);
  return data;
}
async function ensureSession(){
  const s=await getSession();
  if(s.token==='local-admin'&&s.user?.id===LOCAL_ADMIN_ID){currentUser=s.user;return true;}
  try{ const d=await api('/me'); currentUser=d.user; return true; }
  catch(_){ await logout(false); return false; }
}
async function insertReply(i){
  if(!(await ensureSession())){showStatus('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');return;}
  const text=$(`r${i}`).value; if(!text){showStatus('ข้อความปุ่มนี้ว่างอยู่');return;}
  const tab=await getTab(); if(!tab?.id){showStatus('ไม่พบแท็บ LINE OA');return;}
  if(!/^https:\/\/(?:manager|chat)\.line\.biz\//.test(tab.url||'')){showStatus('แท็บปัจจุบันไม่ใช่ LINE OA Chat');return;}
  showStatus('กำลังใส่ข้อความแบบการพิมพ์จริง…');
  try{
    let res;
    try{res=await chrome.tabs.sendMessage(tab.id,{type:'INSERT_QUICK_REPLY',text});}
    catch(_){await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']});res=await chrome.tabs.sendMessage(tab.id,{type:'INSERT_QUICK_REPLY',text});}
    if(res?.ok) showStatus('ใส่ข้อความแล้ว ✓ กดปุ่ม “ส่ง” ของ LINE OA ได้เลย',true);
    else showStatus(res?.error==='AUTH_REQUIRED'?'สิทธิ์สมาชิกหมดอายุ กรุณาเข้าสู่ระบบใหม่':(res?.message||'ใส่ข้อความไม่สำเร็จ'));
  }catch(e){showStatus('เชื่อมต่อหน้า LINE OA ไม่สำเร็จ: '+(e?.message||e));}
}
function calculatePreview(expr){const clean=String(expr||'').replace(/\s+/g,'');if(!/^\d+(?:\.\d+)?(?:[+-]\d+(?:\.\d+)?)+$/.test(clean))return null;const nums=clean.match(/[+-]?\d+(?:\.\d+)?/g);if(!nums||nums.length<2)return null;let total=Number(nums[0]);for(let i=1;i<nums.length;i++)total+=Number(nums[i]);if(!Number.isFinite(total))return null;return Number.isInteger(total)?String(total):String(Number(total.toFixed(10)));}
function updateCalcPreview(){const input=$('calcExample'),out=$('calcPreview'),value=input?.value||'';const m=value.match(/(\d+(?:\.\d+)?(?:\s*[+-]\s*\d+(?:\.\d+)?)+)\s*=\s*$/);if(m){const ans=calculatePreview(m[1]);out.textContent=ans?`${value} *${ans}*`:'พิมพ์รูปแบบ เช่น 258+11=';}else out.textContent='พิมพ์รูปแบบ เช่น 258+11=';}
$('calcToggle').addEventListener('change',async e=>{if(!(await ensureSession())){e.target.checked=false;showStatus('กรุณาเข้าสู่ระบบก่อนใช้งาน');return;}await chrome.storage.local.set({calcEnabled:e.target.checked});showStatus(e.target.checked?'เปิดคำนวณ + / - แล้ว ✓':'ปิดคำนวณ + / - แล้ว',true);});
$('calcExample').addEventListener('input',updateCalcPreview);
$('save').addEventListener('click',async()=>{if(!(await ensureSession())){showStatus('กรุณาเข้าสู่ระบบก่อนใช้งาน');return;}const replies={};for(let i=1;i<=4;i++)replies[i]=$(`r${i}`).value;await chrome.storage.local.set({replies});showStatus('บันทึกข้อความแล้ว ✓',true);});
$('clear').addEventListener('click',async()=>{if(!(await ensureSession())){showStatus('กรุณาเข้าสู่ระบบก่อนใช้งาน');return;}await chrome.storage.local.set({replies:defaults});await load();showStatus('ล้างข้อความแล้ว');});

async function loadMembers(){
  try{
    const d=await api('/admin/members'); const root=$('membersList'); root.innerHTML='';
    if(!d.members.length){root.textContent='ยังไม่มีสมาชิก';return;}
    for(const m of d.members){
      const row=document.createElement('div'); row.className='member-row';
      const info=document.createElement('div'); info.className='member-info';
      const title=document.createElement('strong'); title.textContent=m.id;
      const meta=document.createElement('span'); meta.textContent=`สร้าง ${formatDate(m.createdAt)} · หมดอายุ ${formatDate(m.expiresAt)} · ${m.active?'ใช้งานอยู่':'ปิดใช้งาน'}`;
      info.append(title,meta);
      const controls=document.createElement('div'); controls.className='member-controls';
      const expiry=document.createElement('input'); expiry.type='date'; expiry.value=expiryInputValue(m.expiresAt); expiry.title='เปลี่ยนวันหมดอายุ';
      const saveExpiry=document.createElement('button'); saveExpiry.className='secondary'; saveExpiry.textContent='บันทึกวันหมดอายุ';
      saveExpiry.addEventListener('click',async()=>{try{await api('/admin/members/'+encodeURIComponent(m.id),{method:'PATCH',body:JSON.stringify({expiresAt:expiry.value||null})});memberStatus('อัปเดตวันหมดอายุแล้ว ✓',true);await loadMembers();}catch(e){memberStatus(e.message);}});
      const toggle=document.createElement('button'); toggle.className='secondary'; toggle.textContent=m.active?'ปิดใช้งาน':'เปิดใช้งาน';
      toggle.addEventListener('click',async()=>{try{await api('/admin/members/'+encodeURIComponent(m.id),{method:'PATCH',body:JSON.stringify({active:!m.active})});memberStatus(m.active?'ปิดใช้งานสมาชิกแล้ว':'เปิดใช้งานสมาชิกแล้ว',true);await loadMembers();}catch(e){memberStatus(e.message);}});
      const reset=document.createElement('button'); reset.className='secondary'; reset.textContent='เปลี่ยนรหัส';
      reset.addEventListener('click',async()=>{const pw=prompt(`รหัสผ่านใหม่ของ ${m.id} (อย่างน้อย 8 ตัวอักษร)`);if(pw===null)return;try{await api('/admin/members/'+encodeURIComponent(m.id),{method:'PATCH',body:JSON.stringify({password:pw})});memberStatus('เปลี่ยนรหัสผ่านแล้ว ✓',true);await loadMembers();}catch(e){memberStatus(e.message);}});
      const del=document.createElement('button'); del.className='danger'; del.textContent='ลบสมาชิก';
      del.addEventListener('click',async()=>{if(!confirm(`ยืนยันลบบัญชี ${m.id} ?`))return;try{await api('/admin/members/'+encodeURIComponent(m.id),{method:'DELETE'});memberStatus('ลบสมาชิกแล้ว ✓',true);await loadMembers();}catch(e){memberStatus(e.message);}});
      controls.append(expiry,saveExpiry,toggle,reset,del); row.append(info,controls); root.appendChild(row);
    }
  }catch(e){memberStatus('โหลดรายชื่อไม่สำเร็จ: '+e.message);}
}
$('memberForm').addEventListener('submit',async e=>{e.preventDefault();if(!(await ensureSession()))return;try{const expiry=$('newMemberExpiry').value;await api('/admin/members',{method:'POST',body:JSON.stringify({id:$('newMemberId').value.trim(),password:$('newMemberPassword').value,expiresAt:expiry||null})});$('newMemberId').value='';$('newMemberPassword').value='';$('newMemberExpiry').value='';memberStatus('สร้างบัญชีสมาชิกแล้ว ✓',true);await loadMembers();}catch(err){memberStatus(err.message);}});

async function showLogin(){ $('appView').classList.add('hidden');$('loginView').classList.remove('hidden');$('loginId').focus(); }
async function openApp(user){currentUser=user;$('loginView').classList.add('hidden');$('appView').classList.remove('hidden');$('userLabel').textContent=`${user.id}${user.expiresAt?' · หมดอายุ '+formatDate(user.expiresAt):''}`;await load();if(user.role==='admin'){$('adminPanel').classList.remove('hidden');await loadMembers();}else $('adminPanel').classList.add('hidden');}
$('loginForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const id=$('loginId').value.trim(),password=$('loginPassword').value;
  $('loginStatus').textContent='กำลังตรวจสอบ…';
  try{
    if(id===LOCAL_ADMIN_ID && password===LOCAL_ADMIN_PASSWORD){
      const user={id:LOCAL_ADMIN_ID,role:'admin',active:true,expiresAt:null};
      await chrome.storage.session.set({token:'local-admin',user});
      $('loginPassword').value=''; $('loginStatus').textContent=''; await openApp(user); return;
    }
    const d=await api('/login',{method:'POST',body:JSON.stringify({id,password})});
    await chrome.storage.session.set({token:d.token,user:d.user});
    $('loginPassword').value=''; $('loginStatus').textContent=''; await openApp(d.user);
  }catch(err){$('loginStatus').textContent='เข้าสู่ระบบไม่สำเร็จ: '+(err.message||err);}
});
async function logout(show=true){await chrome.storage.session.set({token:'',user:null});currentUser=null;if(show)showStatus('ออกจากระบบแล้ว');await showLogin();}
$('logout').addEventListener('click',()=>logout(true));
(async()=>{const s=await getSession();if(s.token==='local-admin'&&s.user?.id===LOCAL_ADMIN_ID){await openApp(s.user);return;}if(s.token){try{const d=await api('/me');await openApp(d.user);return;}catch(_){}}await showLogin();})();
