โปรเจกต์นี้แก้ให้ครบแล้วในชุดเดียว

สิ่งที่แก้แล้ว
1) แก้ปัญหา /api/checkout ใช้งานไม่ได้
2) แก้ปัญหา /api/report ใช้งานไม่ได้
3) แก้ปัญหา repairs หา created_at ไม่เจอ
4) เพิ่ม PUT /api/repairs/:id
5) เพิ่ม DELETE /api/repairs/:id
6) เพิ่ม POST /api/logout
7) เพิ่มระบบเติมสต๊อกด้วยบาร์โค้ดในหน้า admin
8) ทำให้โค้ดรองรับทั้ง JSON file และ Supabase
9) ทำให้ชื่อคอลัมน์ฝั่ง Supabase เป็นมาตรฐาน snake_case ทั้งระบบ

สำคัญมาก
ในไฟล์ .env เดิมของคุณใช้คีย์ผิดประเภท
ค่าที่ใส่เป็น sb_publishable_... ซึ่งไม่ใช่ SERVICE ROLE KEY
ถ้าใช้ค่านี้ ระบบจะเขียนข้อมูลลง Supabase ไม่ได้ หรือบาง route จะ fail

ต้องตั้งค่า Render / Railway / เครื่อง local แบบนี้
USE_SUPABASE=true
SUPABASE_URL=ลิงก์โปรเจกต์ supabase ของคุณ
SUPABASE_SERVICE_ROLE_KEY=service_role key ของจริงเท่านั้น
ADMIN_USERNAME=admin
ADMIN_PASSWORD=1234

วิธีหา SERVICE ROLE KEY
Supabase > Project Settings > API > service_role

วิธีอัปเดตฐานข้อมูล Supabase ให้จบทีเดียว
1. เปิด Supabase SQL Editor
2. เอาไฟล์ supabase_schema.sql ไปรันทั้งหมด
3. รอให้รันเสร็จ
4. ค่อย deploy server เวอร์ชันนี้

ระบบเติมสต๊อกด้วยบาร์โค้ดอยู่ตรงไหน
- เข้า /admin.html
- ใต้กล่องเพิ่ม/แก้ไขสินค้า จะมีหัวข้อ “เติมสต๊อกด้วยบาร์โค้ด”
- ยิงบาร์โค้ดสินค้าเดิมในระบบ
- ใส่จำนวน
- กดปุ่ม เติมสต๊อก หรือกด Enter

หมายเหตุ
- ถ้าบาร์โค้ดยังไม่มีในระบบ ต้องเพิ่มสินค้าเข้าระบบก่อน
- ถ้ายังไม่พร้อมใช้ Supabase ให้ใช้ USE_SUPABASE=false ไปก่อน ระบบจะเก็บในไฟล์ JSON ได้ทันที
