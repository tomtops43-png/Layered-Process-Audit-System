# Auto-deploy: GitHub Pages + Google Apps Script

repo นี้มี GitHub Actions 2 ตัว ทำงานเองทุกครั้งที่มีโค้ดเข้า `main`

| Workflow | ทำอะไร | ทำงานเมื่อ |
|----------|--------|-----------|
| `.github/workflows/deploy-pages.yml` | อัปโหลดโฟลเดอร์ `docs/` ขึ้น GitHub Pages | push เข้า `main` ทุกครั้ง |
| `.github/workflows/deploy-appsscript.yml` | `clasp push` โค้ดใน `apps-script/` ขึ้น Apps Script แล้วอัปเดต web app เดิม (URL `/exec` ไม่เปลี่ยน) | มีไฟล์ใน `apps-script/` เปลี่ยน |

สั่งเองได้ตลอดที่ **Actions → (เลือก workflow) → Run workflow**

> ⚠️ ต้องทำ "ตั้งค่าครั้งเดียว" ข้างล่างก่อน ไม่งั้น workflow จะล้ม (แดง) พร้อมบอกว่าขาดอะไร

---

## ส่วนที่ 1: GitHub Pages (ทำครั้งเดียว)

1. repo → **Settings → Pages → Build and deployment → Source**
2. เปลี่ยนจาก **Deploy from a branch** เป็น **GitHub Actions**
3. **Actions → Deploy to GitHub Pages → Run workflow** (หรือ push อะไรก็ได้เข้า `main`)

URL เว็บเหมือนเดิม และยังเสิร์ฟจาก `docs/` เหมือนเดิม — ต่างแค่ว่า deploy ผ่าน Actions
(เห็นผล/ข้อผิดพลาดในแท็บ Actions และต่อยอดใส่ขั้นตอนตรวจก่อน deploy ได้)

---

## ส่วนที่ 2: Google Apps Script (ทำครั้งเดียว บนคอมของคุณ)

### 1. เปิด Apps Script API
https://script.google.com/home/usersettings → **Google Apps Script API** = **ON**

### 2. เอา Script ID และ Deployment ID
ในโปรเจกต์ Apps Script ที่ใช้งานอยู่:
- ⚙️ **Project Settings** → คัดลอก **Script ID**
- **Deploy → Manage deployments** → คัดลอก **Deployment ID** ของ web app ตัวที่ URL ตรงกับ `API_URL` ใน `docs/config.js`

### 3. ติดตั้ง clasp แล้ว login

```bash
npm install -g @google/clasp@3
```

```bash
clasp login
```

เลือกบัญชีที่เป็น **เจ้าของโปรเจกต์ Apps Script** → ได้ไฟล์ `~/.clasprc.json`

> ต้องใช้ clasp **major 3** ให้ตรงกับ workflow — คนละ major เขียนไฟล์เครดิตคนละรูปแบบ
> CI จะขึ้น `Error retrieving access token`

### 4. ใส่ Secrets ใน GitHub
repo → **Settings → Secrets and variables → Actions → New repository secret**

| ชื่อ Secret | ค่า | จำเป็น |
|-------------|-----|--------|
| `CLASPRC_JSON` | เนื้อหาทั้งไฟล์ `~/.clasprc.json` (รวม `{ ... }`) | ✅ |
| `SCRIPT_ID` | Script ID จากข้อ 2 (`apps-script/.clasp.json` ถูก .gitignore ไว้ จึงต้องใส่ทางนี้) | ✅ |
| `DEPLOYMENT_ID` | Deployment ID จากข้อ 2 | ✅ ถ้าอยากให้ URL `/exec` ได้โค้ดใหม่ทุกครั้ง |

ดูเนื้อหาไฟล์เครดิต:

```bash
cat ~/.clasprc.json
```

(Windows cmd: `type %USERPROFILE%\.clasprc.json`)

> ⚠️ `CLASPRC_JSON` คือกุญแจเข้าบัญชี Google — ใส่ใน Secrets เท่านั้น **ห้าม commit ลง repo**

### 5. ทดสอบ
**Actions → Deploy to Apps Script → Run workflow** → เขียวแล้วคือใช้ได้

> `clasp push --force` จะ **เขียนทับ** โค้ดบน Apps Script ด้วยโค้ดใน `apps-script/` ทั้งหมด —
> ถ้าเคยแก้โค้ดในหน้า Apps Script โดยตรงแล้วยังไม่ได้เอามาใส่ repo ให้คัดลอกมา commit ก่อนรันครั้งแรก

---

## แก้ปัญหา

| อาการ | สาเหตุ / วิธีแก้ |
|-------|------------------|
| ล้มที่ **Check secrets** | ยังไม่ได้ใส่ `CLASPRC_JSON` หรือ `SCRIPT_ID` |
| `Error retrieving access token` | token หมดอายุ หรือ login ด้วย clasp คนละ major → รัน `clasp login` (v3) ใหม่ แล้วอัปเดต secret |
| `User has not enabled the Apps Script API` | ยังไม่ได้ทำข้อ 1 |
| ล้มที่ **Verify web app stays public** | `apps-script/appsscript.json` ไม่ได้ตั้ง `ANYONE_ANONYMOUS` / `USER_DEPLOYING` |
| หน้าเว็บเรียก `/exec` แล้วเจอ CORS error | web app ไม่ได้เปิด **Anyone** → Manage deployments → ✏️ → Who has access = **Anyone** → Deploy |
| deploy ผ่านแต่ `/exec` ยังเป็นโค้ดเก่า | ไม่ได้ใส่ `DEPLOYMENT_ID` |
| Pages ล้มที่ **Deploy to GitHub Pages** | ยังไม่ได้เปลี่ยน Settings → Pages → Source เป็น GitHub Actions |
