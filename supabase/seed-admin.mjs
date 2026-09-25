import crypto from 'node:crypto';
const password=process.argv[2]||'445566';
const salt=crypto.randomBytes(16).toString('hex');
const hash=crypto.scryptSync(password,salt,64).toString('base64url');
const q=v=>`'${String(v).replaceAll("'","''")}'`;
console.log(`insert into public.users (id,password_hash,password_salt,role,active,password_version) values (${q('Admingod')},${q(hash)},${q(salt)},${q('admin')},true,1) on conflict (id) do update set password_hash=excluded.password_hash,password_salt=excluded.password_salt,role='admin',active=true,password_version=public.users.password_version+1;`);
