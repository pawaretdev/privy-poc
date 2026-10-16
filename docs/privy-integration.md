# Privy: สรุป POC และสิ่งที่ต้องทำถ้าจะใช้จริง

เอกสารนี้สรุปทุกอย่างที่ทำกับ **Privy** ใน POC นี้ ทั้งส่วนที่ยืนยันแล้วและส่วนที่ยังไม่ได้ยืนยัน และรายการสิ่งที่ต้องทำถ้าจะนำไปใช้กับ Maxion ID จริง ส่วนของ thirdweb แยกไว้ใน [thirdweb-integration.md](thirdweb-integration.md) ขั้นตอนตั้งค่าแบบละเอียดอยู่ใน [firebase-setup.md](firebase-setup.md)

## สรุปสั้น

POC ทดลองใช้ Privy สองแบบ ซึ่งเป็นคนละเรื่องกัน:

| | 1. Ronin Stash connector | 2. Privy embedded wallet ของเราเอง |
|---|---|---|
| คืออะไร | เชื่อม wallet **Ronin Stash** ที่ผู้ใช้มีอยู่แล้ว (Stash คือ Privy global wallet ของ Sky Mavis) | แอป Privy **ของเรา** สร้าง wallet ให้ผู้ใช้หลัง login Google ผ่าน Firebase |
| ผู้ใช้ต้องกดอะไร | popup ของ Stash ให้ login และกดยินยอม อย่างน้อยครั้งแรก | ไม่ต้องกดอะไรเลย สร้างให้อัตโนมัติ |
| wallet อยู่ที่ไหน | ในแอป Ronin Stash | ในแอป Privy ของเรา ผู้ใช้ export key ไปใช้ใน Ronin Wallet ได้ |
| ค่าใช้จ่าย | ฟรีฝั่งเรา | คิดตาม MAU ของ Privy |
| server เก็บ mapping | ❌ ไม่มี | ✅ ตาราง `privy_wallet` |
| หน้าใน POC | `/` (การ์ดบน) | `/` (การ์ด "Firebase + your wallet") |

ข้อจำกัดของ Stash ที่แก้จากฝั่งเราไม่ได้: Stash ตั้ง `custom_jwt_auth: false` และอนุญาตเฉพาะ domain ของ Sky Mavis เราจึงใช้ Firebase login แทน login ของ Stash ไม่ได้ ต้องมี popup ของ Stash อย่างน้อยหนึ่งครั้งเสมอ (ดูแผนภาพ `docs/wallet-options.html`)

## 1. Ronin Stash connector

**Flow:** wagmi + `toPrivyWalletConnector({ id: 'cmpkwmb7l001c0bjp3sdn6n8e' })` เปิด popup ของ Stash → ผู้ใช้ login และยินยอม → แอปได้ address และ chain

- ไฟล์: [src/config.ts](../src/config.ts), [src/App.tsx](../src/App.tsx)
- App ID ของ Stash ได้มาจาก frontend ของ Ronin Wallet และตรวจกับ `auth.privy.io/api/v1/apps/<id>` แล้ว (ชื่อแอป "Ronin Stash" เมื่อ 2026-10-15) **ต้องยืนยันกับ Sky Mavis ก่อนใช้จริง**
- มีปุ่ม "Sign test message" ไว้ทดสอบว่า Stash ยอมให้แอปเราขอลายเซ็นได้หรือไม่ การ sign ไม่เสีย gas และไม่มีอะไรเกิดขึ้นบน chain

**ข้อควรระวัง:** การได้ address จาก connector **ไม่ใช่** การยืนยันตัวตนฝั่ง server ถ้าจะผูก address นี้กับ Maxion ID ต้องให้ server ออก challenge แล้วตรวจลายเซ็น (SIWE) ซึ่งทำให้ผู้ใช้ต้องกดยินยอมเพิ่มอีกหนึ่งครั้ง

## 2. Privy embedded wallet ของเรา (Firebase → Privy)

### Flow

```
Google sign-in (Firebase)
  → POST /api/auth/privy-jwt          server ตรวจ Firebase ID token แล้วออก JWT อายุ 5 นาที
                                       sub = Firebase UID, aud = Privy App ID, ลงนามด้วย RS256
  → useSubscribeToJwtAuthWithFlag      Privy ดึง JWKS จาก /api/.well-known/jwks.json มาตรวจ JWT
  → createWallet()                     ถ้ายังไม่มี (กันการสร้างซ้ำข้าม tab ด้วย Web Locks)
  → POST /api/wallet/sync              server ถาม Privy ด้วย app secret แล้วบันทึกลง privy_wallet
```

- Frontend: [src/FirebaseWallet.tsx](../src/FirebaseWallet.tsx)
- Server: [server/app.mjs](../server/app.mjs), [server/privy.mjs](../server/privy.mjs), [server/jwt.mjs](../server/jwt.mjs), [server/store.mjs](../server/store.mjs), [server/schema.sql](../server/schema.sql)
- Test: [tests/api.test.mjs](../tests/api.test.mjs)

### ทำไมต้องมี JWT bridge แทนที่จะส่ง Firebase token ให้ Privy ตรงๆ

key ที่ Firebase ใช้เซ็น token เป็นชุดเดียวกันทุก Firebase project ถ้าตั้ง JWKS ของ Google ใน Privy ตรงๆ token จาก Firebase project อื่นก็จะผ่านด้วย server ของเราจึงตรวจก่อนว่า token มาจาก project ที่ถูกต้อง ยังไม่หมดอายุ ไม่ถูก revoke และ user ไม่ถูก disable แล้วจึงออก JWT ใหม่ที่ใช้กับแอปเราเท่านั้น (aud = Privy App ID) อายุ 5 นาที

### ข้อมูลที่เก็บ (SQLite จำลอง maxion-id)

| ตาราง | ความหมาย |
|---|---|
| `user` | จำลองตาราง `user` ของ maxion-id: `user_id` = Firebase UID (unique), มี uuid, email, provider |
| `privy_wallet` | `user_id` → `user.id`, `privy_app_id`, `privy_user_id`, `privy_wallet_id`, `wallet_address`, `chain_type='ethereum'`, `default_chain_id=2020` |

unique constraint กันการผูกซ้ำได้ทุกทาง: 1 user ต่อ 1 wallet ต่อแอป และ 1 wallet id / 1 address ผูกได้แค่ 1 user ถ้ามี mapping อยู่แล้วและข้อมูลใหม่ไม่ตรง server จะตอบ 409 ไม่เขียนทับเงียบๆ

### ขอบเขตความเชื่อถือ (trust boundary)

- browser **ไม่เคย** ส่ง UID, wallet id หรือ address ให้ server บันทึก server หา wallet เองจาก Privy API (`POST /v1/users/custom_auth/id`) ด้วย UID ที่ได้จาก token ที่ตรวจแล้ว
- เลือกเฉพาะ embedded wallet ที่เป็น Ethereum ไม่ได้ import มา และไม่มี delegated signer ถ้ามีหลายใบให้ปฏิเสธ
- ไม่มี token, private key หรือ secret ถูกเก็บใน DB ส่วน key ที่ใช้เซ็น JWT อยู่ที่ `data/privy-jwt-private.pem` ซึ่ง git ignore ไว้และ Vite ไม่ยอมเสิร์ฟไฟล์นี้

### Gas sponsorship ของ Privy (ค้นข้อมูลแล้ว แต่ยังไม่ได้ทดสอบ)

- จากเอกสาร Privy โหมด "App pays" รองรับ **Ronin mainnet และ Ronin Saigon** ใช้ EIP-7702 ร่วมกับ paymaster ของ Privy เรียกด้วย `useSendTransaction().sendTransaction(tx, { sponsor: true })`
- ข้อกำหนดตามเอกสาร: เปิด "Sponsor gas fees" ใน dashboard, เลือก chain, แอปต้องใช้ **TEE execution** (แอปเก่าอาจต้อง migrate) และต้องมีเครดิตแบบ prepaid หรือใช้ postpaid ซึ่งต้องเป็นแผน Enterprise
- เคยเพิ่มปุ่มทดสอบไว้แล้วลบออก เพราะเลือกทดสอบ sponsorship กับ thirdweb แทน **ยังไม่มีผลทดสอบจริงของ Privy**
- ข้อดีเมื่อเทียบกับ thirdweb: Privy ระบุว่ารองรับ Saigon ในขณะที่ bundler ของ thirdweb ยังไม่รับ 202601

### ผลที่ยืนยันแล้วและยังไม่ได้ยืนยัน

| เรื่อง | สถานะ |
|---|---|
| API ปฏิเสธ token ปลอมหรือ origin ที่ไม่อนุญาต, แยกผู้ใช้, sync ซ้ำหรือพร้อมกัน, กันการ remap | ✅ unit test (`npm test`) |
| login Google จริง → สร้าง wallet → บันทึก mapping | ✅ ทำงานจริง ใน DB จำลองมี `privy_wallet` 4 แถวจาก login จริงตั้งแต่ 2026-10-15 |
| ส่ง transaction หรือ sign จาก embedded wallet | ⚠️ ยังไม่ได้ทำใน POC |
| Gas sponsorship ของ Privy | ⚠️ ยังไม่ได้ทดสอบ |
| Stash ยอมให้แอปเรา sign ได้ไหม | ⚠️ มีปุ่มทดสอบแล้ว แต่ไม่ได้บันทึกผลไว้ในเอกสารนี้ |

## ถ้าจะทำจริง ต้องทำอะไรบ้าง

### Privy dashboard และสัญญา

- [ ] สร้าง Privy app สำหรับ production แยกจาก dev แต่ละ environment ใช้ App ID และ secret ของตัวเอง
- [ ] ขอเปิด **Custom authentication (JWT)** กับ Privy ฟีเจอร์นี้อาจต้องขอสิทธิ์ แล้วตั้ง JWKS URL, ID claim = `sub` และ aud
- [ ] ตั้ง allowed origins ให้ตรงกับ domain production
- [ ] ตกลงนโยบาย wallet: user-controlled, ไม่มี delegated/session signer, เปิดให้ export key ได้หรือไม่
- [ ] ถ้าจะใช้ sponsorship: เปิด TEE execution, เลือก chain, เติมเครดิต และหาวิธีจำกัดว่า sponsor อะไรได้บ้าง (ดูหัวข้อความปลอดภัย)
- [ ] ประเมินค่าใช้จ่าย: Privy คิดตาม MAU บวกค่า gas ถ้า sponsor ดูราคาล่าสุดที่ [privy.io/pricing](https://www.privy.io/pricing)
- [ ] ถ้าจะใช้ Stash connector: ยืนยัน App ID ของ Stash และเงื่อนไขการใช้กับ Sky Mavis

### Backend (Maxion)

- [ ] ย้าย JWT bridge (`/api/auth/privy-jwt` และ `/.well-known/jwks.json`) ไปไว้ใน service ที่ตรวจ Firebase token อยู่แล้ว ต้องเปิดให้ Privy เรียก JWKS ได้จาก internet
- [ ] **key สำหรับเซ็น JWT:** เก็บใน KMS หรือ secret manager แทนไฟล์ `.pem` วางแผน rotate key โดยใส่ทั้ง key เก่าและใหม่ใน JWKS ช่วงเปลี่ยนผ่าน และใช้ `kid` ให้ถูกต้อง
- [ ] `PRIVY_APP_SECRET` เก็บใน secret manager ห้ามมี prefix `VITE_` หรือหลุดไปถึง client
- [ ] endpoint wallet sync: ใช้ logic เดียวกับ [server/privy.mjs](../server/privy.mjs) คือหา wallet จาก UID ที่ตรวจแล้ว ไม่รับค่าจาก browser มีการ timeout และ retry และตอบ 409 เมื่อข้อมูลไม่ตรง
- [ ] rate limit endpoint ออก JWT และ sync

### Database (maxion-id)

- [ ] สร้างตาราง `privy_wallet` (หรือชื่อที่ตกลงกัน) ผ่าน migration ใน **maxion-account-web-service เท่านั้น** (`src/prisma/maxion_id/migrations`) repo อื่นดึง schema ด้วย `prisma db pull`
- [ ] ใส่ unique constraint ให้ครบเหมือน POC: (user, app, chain_type), (app, privy_wallet_id), (app, privy_user_id, chain_type), (app, wallet_address)
- [ ] **ห้ามเพิ่มคอลัมน์ NOT NULL ในตาราง `user`** ถ้าจำเป็นต้องใส่ default ฝั่ง DB เพราะมี 10 repo ที่ insert ลง `user` ตอน Firebase login ครั้งแรก ให้เก็บข้อมูล wallet ในตารางแยกเหมือน POC
- [ ] ถ้ามีคอลัมน์ uuid ที่ใช้ `DEFAULT (uuid())` บน RDS MySQL 8.4 (เปิด binlog อยู่) `ADD COLUMN ... DEFAULT (uuid())` จะถูกปฏิเสธ (error 1674) ให้เพิ่มเป็น nullable ก่อน, backfill แล้วค่อย `MODIFY`
- [ ] ตัดสินใจเรื่องความสัมพันธ์กับตาราง `wallet`, `ronin_wallet`, `maxion_wallet` เดิมว่าจะแสดง wallet ไหนเป็น wallet หลักของผู้ใช้

### Frontend

- [ ] ใช้ `@privy-io/react-auth` และ pin version ไว้ ใช้ flow เดียวกับ `FirebaseWallet.tsx`: subscribe JWT แล้ว `createWallet` เมื่อยังไม่มี แล้วเรียก sync
- [ ] ถ้าส่ง transaction: ตัดสินใจว่าจะแสดงหน้าต่างยืนยันของ Privy (ค่าตั้งต้น) หรือปิดด้วย `showWalletUIs: false`
- [ ] รองรับกรณีหลายแท็บ สลับบัญชี และ retry sync

### ความปลอดภัยและการดูแลระบบ

- [ ] ถ้าเปิด sponsorship: ผู้ใช้ที่ login แล้วเปิด DevTools ส่ง transaction อะไรก็ได้ แล้วให้ Privy จ่าย gas ต้องหาวิธีจำกัดฝั่ง server เหมือน server verifier ของ thirdweb (ดู [thirdweb-integration.md](thirdweb-integration.md#server-verifier)) **ยังไม่ได้ตรวจว่า Privy มีกลไกแบบนี้หรือไม่**
- [ ] monitor: จำนวน wallet ที่สร้าง, sync ที่ล้มเหลวหรือได้ 409, และค่า MAU / gas
- [ ] ระบบหลังบ้านที่เช็ก transaction ต้องดูจาก event หรือ `msg.sender` ไม่ใช่ `tx.from` เพราะ transaction แบบ sponsored จะมี `tx.from` เป็นของคนที่จ่าย gas

## อ้างอิง

- [Privy custom JWT setup](https://docs.privy.io/authentication/user-authentication/jwt-based-auth/setup)
- [Privy server lookup by custom auth ID](https://docs.privy.io/api-reference/users/get-by-custom-auth)
- [Privy gas sponsorship overview](https://docs.privy.io/wallets/gas-and-asset-management/gas/overview)
- [Privy gas sponsorship setup](https://docs.privy.io/wallets/gas-and-asset-management/gas/setup)
- [Privy global wallets (Stash)](https://docs.privy.io/wallets/global-wallets/overview)
- [Firebase token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens)
