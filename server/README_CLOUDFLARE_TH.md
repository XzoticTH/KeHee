# Cloudflare D1 API สำหรับ V21

ไฟล์ `cloudflare-worker.js` เป็น API ที่เข้ากันได้กับ Extension V21 เดิม โดยใช้ Cloudflare D1 แทน SQLite

## ติดตั้ง

```bash
npm install -g wrangler
wrangler login
wrangler d1 create kheitai-membership
```

นำ `database_id` ที่ได้ไปใส่ใน `wrangler.toml` แล้วสร้างตาราง:

```bash
wrangler d1 execute kheitai-membership --remote --file=./schema.sql
wrangler secret put TOKEN_SECRET
wrangler deploy
```

สร้างบัญชีผู้ดูแลเริ่มต้นโดยไม่เก็บรหัสผ่าน plaintext:

```bash
node seed-admin.mjs "รหัสผ่านใหม่ของคุณ" > admin.sql
wrangler d1 execute kheitai-membership --remote --file=./admin.sql
```

อย่า commit ไฟล์ `admin.sql` ลง Git และควรลบทิ้งหลัง import

ตั้งค่า API ใน Extension เป็น URL Worker เช่น `https://ชื่อของคุณ.workers.dev/api` ได้ทันที

รองรับ: login, `/me`, สร้างสมาชิก, เปลี่ยนรหัสผ่าน, ต่ออายุ/เปลี่ยนวันหมดอายุ, เปิด/ระงับ, ลบ และดูรายชื่อสมาชิก การเปลี่ยนรหัสผ่านจะเพิ่ม `password_version` ทำให้ token เดิมใช้ไม่ได้ และ `/me` จะตรวจ active/วันหมดอายุทุกครั้ง
