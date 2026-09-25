import crypto from 'node:crypto';
const password = process.argv[2];
if (!password || password.length < 8) throw new Error('ใช้: node seed-admin.mjs <รหัสผ่านอย่างน้อย 8 ตัว>');
const salt = crypto.randomBytes(16).toString('base64url');
const hash = crypto.pbkdf2Sync(password, salt, 210000, 32, 'sha256').toString('base64url');
const q = v => `'${String(v).replaceAll("'", "''")}'`;
console.log(`INSERT INTO users (id,password_hash,password_salt,role,created_at,expires_at,active,password_version) VALUES (${q('AdminGod')},${q(hash)},${q(salt)},${q('admin')},${q(new Date().toISOString())},NULL,1,1);`);
