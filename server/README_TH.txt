ระบบสมาชิกออนไลน์ คีไทประดิษฐ์.Com — V21

สิ่งที่มีในระบบ
- Login ผ่าน API บนเซิร์ฟเวอร์
- ฐานข้อมูล SQLite (members.sqlite)
- Password hash ด้วย Node scrypt ไม่เก็บรหัสผ่านเป็นตัวอักษรตรง ๆ
- Token อายุ 12 ชั่วโมง และตรวจสอบบัญชีจากฐานข้อมูลทุก request
- เปลี่ยนรหัสผ่าน/ปิดใช้งาน/เปิดใช้งาน/เปลี่ยนวันหมดอายุได้จาก Admin
- สมาชิกหมดอายุจะ Login ไม่ได้ และ token เดิมจะใช้ต่อไม่ได้
- ลบบัญชีสมาชิกได้ทันที
- จำกัดการลอง Login ผิดเบื้องต้น 10 ครั้งต่อ 15 นาทีต่อ IP

บัญชีเริ่มต้น
ADMIN_ID=AdminGod
ADMIN_PASSWORD=445566

สำคัญ: หลังติดตั้งจริงควรเปลี่ยน ADMIN_PASSWORD และ TOKEN_SECRET ทันที

ติดตั้ง
1) ติดตั้ง Node.js 18+ บน VPS/โฮสต์
2) คัดลอกโฟลเดอร์ server ไปยังเซิร์ฟเวอร์
3) รัน: npm install
4) ตั้ง environment variables ตาม .env.example
5) รัน: npm start
6) ใช้ Nginx/Cloudflare Tunnel/Reverse Proxy ทำ HTTPS แล้วส่ง /api ไปยังแอปนี้
7) ใน Extension ให้ใส่ API URL เช่น https://your-domain.com/api

ตัวอย่าง endpoint
POST /api/login
GET  /api/me
GET  /api/admin/members
POST /api/admin/members
PATCH /api/admin/members/:id
DELETE /api/admin/members/:id

หมายเหตุด้านความปลอดภัย
Chrome Extension เป็นโค้ดที่อยู่บนเครื่องผู้ใช้ จึงไม่มีทางทำให้โค้ดฝั่ง Client แกะไม่ได้ 100% หากผู้ใช้มีความรู้และแก้ Extension เอง ดังนั้นสิ่งที่เซิร์ฟเวอร์บังคับได้จริงคือ “สิทธิ์การเข้าถึงบัญชี/ข้อมูล/การออก token” ส่วนการแทรกข้อความเข้า LINE เป็นการทำงานในเครื่องผู้ใช้ หากต้องการควบคุมสิทธิ์ฟีเจอร์นั้นแบบเข้มงวด ต้องออกแบบให้ Extension ขอสิทธิ์/ใบอนุญาตจากเซิร์ฟเวอร์ก่อนใช้งานและตรวจซ้ำเป็นระยะ

แนะนำให้ใช้ HTTPS เท่านั้น และอย่าเปิดพอร์ต HTTP ของ Node ให้ผู้ใช้ทั่วไปเข้าตรง ๆ
