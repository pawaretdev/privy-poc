# thirdweb: สรุป POC และสิ่งที่ต้องทำถ้าจะใช้จริง

เอกสารนี้สรุปทุกอย่างที่ทำกับ **thirdweb** ใน POC นี้ ทั้งส่วนที่ยืนยันแล้วและส่วนที่ยังไม่ได้ยืนยัน และรายการสิ่งที่ต้องทำถ้าจะนำไปใช้กับ Maxion ID จริง ส่วนของ Privy แยกไว้ใน [privy-integration.md](privy-integration.md) ขั้นตอนตั้งค่าแบบละเอียดอยู่ใน [thirdweb-setup.md](thirdweb-setup.md)

## สรุปสั้น

- ผู้ใช้ login Google (Firebase) แล้วได้ **in-app wallet ของ thirdweb ทันที** ไม่ต้องกดยินยอม ไม่ต้องเซ็น message และไม่มีหน้าต่างยืนยันตอนส่ง transaction
- **Gas sponsorship บน Ronin mainnet (2020) ใช้ได้จริง:** ทดสอบด้วย tx แบบ EIP-7702 สำเร็จ wallet ผู้ใช้มี 0 RON แต่ thirdweb จ่าย gas ให้
- **Ronin Saigon (202601) ยังใช้ sponsorship ไม่ได้:** bundler ของ thirdweb ตอบ `Invalid chain: 202601` เปิด support case ไว้แล้ว
- มี **server verifier** ที่จำกัดให้ sponsor เฉพาะชิ้นที่อนุญาตบน Mavis Market ตอนนี้คือ Chicken Saga Resources #32 เท่านั้น
- server บันทึก mapping UID → wallet ลงตาราง `thirdweb_wallet` หลังให้ thirdweb ยืนยันว่า wallet นั้นเป็นของ UID นี้จริง
- หน้าใน POC: `/thirdweb.html`

## Flow

```
Google sign-in (Firebase)
  → POST /api/auth/thirdweb-jwt         server ตรวจ Firebase ID token แล้วออก JWT อายุ 5 นาที
                                         sub = Firebase UID, aud = thirdweb AUD, ใช้ key และ JWKS ชุดเดียวกับ Privy
  → inAppWallet().connect({ strategy: 'jwt', jwt })
                                         thirdweb ดึง JWKS มาตรวจ แล้วได้ wallet เดิมทุกครั้งสำหรับ sub เดียวกัน
  → POST /api/thirdweb/wallet/sync      server ถาม thirdweb ด้วย secret key แล้วบันทึกลง thirdweb_wallet
  → sendTransaction(...)                 SDK เซ็นให้ทันทีโดยไม่มี popup และ thirdweb จ่าย gas (sponsorGas)
                                         ก่อนจ่าย thirdweb เรียก server verifier ของเราเพื่อขออนุญาต
```

| ส่วน | ไฟล์ |
|---|---|
| หน้าเว็บ | [src/thirdweb/ThirdwebWallet.tsx](../src/thirdweb/ThirdwebWallet.tsx), [thirdweb.html](../thirdweb.html) |
| JWT bridge | [server/app.mjs](../server/app.mjs) (`/api/auth/thirdweb-jwt`), [server/jwt.mjs](../server/jwt.mjs) |
| wallet sync | [server/thirdweb.mjs](../server/thirdweb.mjs), [server/store.mjs](../server/store.mjs) (`saveThirdwebWallet`), [server/schema.sql](../server/schema.sql) |
| server verifier + Mavis Market | [server/mavisMarket.mjs](../server/mavisMarket.mjs), route `/api/thirdweb/verify-transaction` และ `/api/market/buy-tx` |
| test | [tests/thirdweb-wallet.test.mjs](../tests/thirdweb-wallet.test.mjs), [tests/sponsor.test.mjs](../tests/sponsor.test.mjs), [tests/api.test.mjs](../tests/api.test.mjs) |

## Execution mode: ใช้ EIP-7702

| | **EIP-7702 (แนะนำ)** | ERC-4337 |
|---|---|---|
| address | EOA เดิมของผู้ใช้ | smart account ซึ่งเป็นคนละ address กับ EOA |
| gas | น้อยกว่า | tx แรกต้อง deploy contract |
| ลงขายบน Mavis Market | ✅ ได้ เพราะ contract ตรวจลายเซ็น ECDSA | ❌ ไม่ได้ เพราะ contract ไม่รองรับ ERC-1271 |
| ตั้งค่า | `VITE_THIRDWEB_EXECUTION_MODE=7702` (default) | `=4337` |

**หลักฐานบน mainnet** (2026-10-16): tx [`0x1e6357ec…2e29`](https://app.roninchain.com/tx/0x1e6357ec3dce0e6ade3542ed7871efa2604b0c4c75d5204ef4aed97ad7c02e29)
- เป็น type `0x4` ส่งโดย executor ของ thirdweb (`0xE0F2…2272`) ไปที่ address ของผู้ใช้
- ใช้ gas 84,968 ≈ 0.0018 RON thirdweb เป็นคนจ่าย
- หลังจากนั้น code ของ address ผู้ใช้กลายเป็น `0xef0100` + `3E51…f35b` (delegate ไปที่ MinimalAccount ของ thirdweb)

**เรื่อง `tx.from`:** ใน transaction แบบ sponsored ช่อง `from` คือ executor ของ thirdweb เสมอ ส่วน contract ปลายทางเห็น `msg.sender` เป็น address ของผู้ใช้ **ระบบหลังบ้านหรือ indexer ต้องดูจาก event หรือ `msg.sender` ห้ามดูจาก `tx.from`**

## ความเข้ากันได้กับ Mavis Market

อ่านจาก source code ที่ verify ไว้บน Sourcify (address ของ contract ดึงจาก `@sky-mavis/mavis-market-core`):

- MarketGateway `0x3b3a…3fe3` และ logic contract `ORDER_EXCHANGE` (ERC-721) / `ERC1155_EXCHANGE` **ไม่มีการเช็ก `tx.origin`** และไม่บังคับว่าผู้เรียกต้องเป็น EOA
- `buyer = msg.sender` ในโหมด 7702 NFT จึงเข้า EOA ของผู้ใช้
- ลายเซ็นของ order ตรวจด้วย `ECDSA.recover` อย่างเดียว ไม่รองรับ ERC-1271 จึงต้องใช้โหมด 7702 ถ้าผู้ใช้จะลงขาย
- **thirdweb จ่ายแค่ค่า gas** ราคา NFT ผู้ใช้ต้องจ่ายเองเป็น RON, WRON หรือ USDC ตาม order
- จำลองการซื้อด้วย `eth_call` ผ่านทั้ง Resources #32 และ Game Items #1 (ใช้ gas ราว 280k-290k)

## Server verifier

**ทำไมต้องมี:** client ID อยู่ใน JavaScript ฝั่ง browser ผู้ใช้ที่ login แล้วเปิด DevTools บนเว็บเราเอง เรียก `sendTransaction` ด้วยข้อมูลอะไรก็ได้ แล้ว thirdweb จะจ่าย gas ให้ด้วยเครดิตของเรา การตั้ง allowed domains หรือจำกัด contract ใน dashboard กันเรื่องนี้ไม่ได้ เพราะการซื้อทุก collection ผ่าน gateway ตัวเดียวกัน

**วิธีทำงาน:** ก่อนจ่าย gas thirdweb จะ `POST` มาที่ `/api/thirdweb/verify-transaction` พร้อม `chainId` และ `userOp.data.{targets, callDatas, values}` server ตอบกลับ `{ isAllowed, reason }`

ใน [server/mavisMarket.mjs](../server/mavisMarket.mjs) `verifySponsorship` อนุญาตแค่สองกรณี และถ้าไม่แน่ใจให้ปฏิเสธ (fail closed):
1. ส่ง 0 RON เข้า address ตัวเอง (ปุ่ม test)
2. ซื้อผ่าน gateway โดย **ทุกชิ้น** ใน order อยู่ใน `THIRDWEB_SPONSOR_ITEMS` รูปแบบคือ `0xCollection:tokenId` หรือ `0xCollection:*` ค่าตั้งต้นคือ Resources #32

`marketAssets` แกะ calldata 3 ชั้น คือ `interactWith` → `settleOrder` → `orderData` แล้วดึง `{collection, tokenId}` ออกมา ถ้า decode ไม่ได้ หรือ chain ไม่ใช่ 2020 หรือไม่มี calldata หรือเรียก contract อื่น ให้ปฏิเสธทั้งหมด route ตรวจ header `x-verifier-secret` ก่อนทุกครั้ง

| ทดสอบผ่าน `fe.pawaret.uk` | ผล |
|---|---|
| Resources #32 | ✅ allow |
| Resources #33 (collection เดียวกัน) | ❌ deny |
| Game Items #1 | ❌ deny |

**ยังไม่ได้ยืนยัน:** thirdweb เรียก verifier ด้วยหรือไม่ เมื่อใช้โหมด **7702** เอกสารของ thirdweb พูดถึงแต่ `userOp` ของ 4337 วิธีทดสอบคือตั้ง URL และ header ใน dashboard แล้วกดซื้อทั้ง 3 ปุ่มบนหน้า thirdweb ถ้ามีบรรทัด `[sponsor] DENY` ใน log และซื้อ Game Items ไม่สำเร็จ แปลว่าใช้ได้ (ขั้นตอนอยู่ใน [thirdweb-setup.md](thirdweb-setup.md#server-verifier-mavis-market-buy-test))

## การบันทึก wallet ลง DB (`thirdweb_wallet`)

1. หน้าเว็บ connect เสร็จแล้วส่ง address ของ EOA (admin account) ไปที่ `POST /api/thirdweb/wallet/sync` พร้อม Firebase token
2. server ใช้ address นั้นเป็นแค่ตัวช่วยค้น แล้วเรียก `embedded-wallet.thirdweb.com/.../user-details?queryBy=walletAddress` ด้วย `THIRDWEB_SECRET_KEY` (endpoint เดียวกับ `getUser()` ของ SDK)
3. บันทึกเฉพาะเมื่อ user ที่ thirdweb ตอบกลับมามี profile แบบ JWT ที่ id ตรงกับ Firebase UID ซึ่งได้จาก token ที่ตรวจแล้ว และ address ตรงกัน
4. ใช้กฎเดียวกับ `privy_wallet`: บันทึกครั้งแรกแล้วยึดตามนั้น ถ้าข้อมูลใหม่ไม่ตรงตอบ 409 และไม่มีวันเขียนทับเงียบๆ

| คอลัมน์ | |
|---|---|
| `user_id` → `user.id` | unique ร่วมกับ `thirdweb_client_id` |
| `thirdweb_client_id`, `thirdweb_user_id` | unique (client, thirdweb user) |
| `wallet_address` | EOA, unique ต่อ client |
| `auth_strategy='jwt'`, `default_chain_id=2020`, `ownership='user-controlled'` | |

**ยังไม่ได้ยืนยันกับ API จริง:** ชื่อ type และฟิลด์ของ profile แบบ custom JWT ตอนนี้โค้ดยอมรับ `jwt`/`custom_jwt` คู่กับ `details.id`/`sub`/`userId` ถ้า response จริงไม่ตรง sync จะตอบ 403 และบอกชื่อ profile type ที่เจอ ต้องใส่ `THIRDWEB_SECRET_KEY` แล้ว login หนึ่งครั้งเพื่อยืนยัน

ถ้าอยากได้ address ก่อนผู้ใช้ login ครั้งแรก thirdweb มี API **pregenerate** ซึ่งต้องใช้ secret key เหมือนกัน แต่เอกสารยังเขียนไม่ตรงกันว่าใช้ endpoint ไหนและ type ชื่ออะไร จึงยังไม่ได้ใช้

## ผลที่ยืนยันแล้วและยังไม่ได้ยืนยัน

| เรื่อง | สถานะ |
|---|---|
| login Google → ได้ wallet โดยไม่มี popup | ✅ ใช้จริงแล้ว |
| tx แบบ 7702 sponsored บน mainnet | ✅ tx `0x1e63…2e29` |
| bundler 2020 รองรับ 7702 (delegation `0x3E51…f35b`, EntryPoint v0.6/v0.7) | ✅ |
| sponsorship บน Saigon 202601 | ❌ bundler ปฏิเสธ รอ thirdweb |
| verifier ตัดสินถูกตามที่ออกแบบ (unit test + ยิงผ่าน tunnel) | ✅ |
| thirdweb เรียก verifier ในโหมด 7702 | ⚠️ ยังไม่ได้ทดสอบ |
| ซื้อบน Mavis Market จริงผ่าน wallet ที่ถูก delegate แล้ว | ⚠️ จำลองด้วย `eth_call` เท่านั้น |
| wallet sync กับ API จริงของ thirdweb | ⚠️ ทดสอบด้วยข้อมูลจำลองเท่านั้น |

## ถ้าจะทำจริง ต้องทำอะไรบ้าง

### thirdweb dashboard และสัญญา

- [ ] แยก project ระหว่าง dev และ production ใช้ client ID และ secret key คนละชุด
- [ ] **Allowed domains** ของ client ID ใส่เฉพาะ domain production
- [ ] **In-App Wallets → Custom JWT:** ตั้ง JWKS URI ของ production และค่า AUD
- [ ] **Gas Sponsorship:**
  - chain = 2020
  - เปิด global spend limit
  - ตั้ง **server verifier** เป็น URL production พร้อม header `x-verifier-secret`
  - ปิดหรือไม่ใช้ "restrict to contract" เพราะ verifier ละเอียดกว่า
- [ ] ผูกบัตรเครดิตหรือ billing เพราะ sponsor บน mainnet ต้องมีวิธีชำระเงิน
- [ ] ตาม support case เรื่อง 202601 ถ้า thirdweb ยังไม่เปิด จะทดสอบบน testnet แบบ sponsored ไม่ได้ ต้องวางแผน QA บน mainnet ด้วยวงเงินจำกัด
- [ ] ประเมินค่าใช้จ่าย: in-app wallet MAU + ค่า gas ที่ sponsor + ค่าบริการของ thirdweb ดูที่ [thirdweb.com/pricing](https://thirdweb.com/pricing) ถ้าจะใช้ Dedicated Relayer เริ่มที่ $99/เดือน

### Backend (Maxion)

- [ ] ย้าย JWT bridge `/api/auth/thirdweb-jwt` และ JWKS ไปไว้ใน service ที่ตรวจ Firebase token อยู่แล้ว ใช้ key ใน KMS หรือ secret manager และวางแผน rotate key (ใช้ `kid` และใส่ทั้ง key เก่าและใหม่ใน JWKS ช่วงเปลี่ยนผ่าน)
- [ ] `THIRDWEB_SECRET_KEY` และ `THIRDWEB_VERIFIER_SECRET` เก็บใน secret manager ห้ามมี prefix `VITE_`
- [ ] **server verifier ใน production:**
  - เป็น endpoint สาธารณะที่ thirdweb เรียกได้ ต้อง latency ต่ำและ uptime สูง (ต้องทดสอบว่าถ้า verifier ล่มหรือ timeout thirdweb จะปฏิเสธหรือปล่อยผ่าน)
  - ย้ายรายการชิ้นที่อนุญาตจาก env ไปไว้ใน DB หรือ config ที่ทีมแก้ได้
  - เพิ่ม **rate limit ต่อผู้ใช้หรือต่อ wallet** เช่น จำนวน tx ต่อวัน และวงเงิน gas ต่อผู้ใช้
  - เก็บ log ทุกครั้งที่ allow หรือ deny ไว้ตรวจย้อนหลัง
  - ถ้าจะ sponsor การลงขาย ยกเลิก order หรือ approve ต้องเพิ่มตัว decode ของ `setApprovalForAll`, `cancelOrder` และ multisend / collection offer โดยยังยึดหลัก fail closed
- [ ] **wallet sync:** ยืนยันรูปแบบ response ของ user-details กับ API จริง ใส่ timeout และ retry และ monitor อัตรา 403/409
- [ ] สร้างธุรกรรมซื้อขาย Mavis Market ฝั่ง server (`/api/market/buy-tx`) ใช้ order ล่าสุดจาก GraphQL ของ Sky Mavis จะใช้ `@sky-mavis/mavis-market-core` ก็ได้ แต่ต้องรู้ว่าใช้ ethers v5 และมี rate limit 300 ครั้งต่อนาที

### Database (maxion-id)

- [ ] สร้างตาราง `thirdweb_wallet` ผ่าน migration ใน **maxion-account-web-service เท่านั้น** (`src/prisma/maxion_id/migrations`) repo อื่นดึงด้วย `prisma db pull`
- [ ] unique: (user, client), (client, thirdweb_user_id), (client, wallet_address)
- [ ] **ห้ามเพิ่มคอลัมน์ NOT NULL ในตาราง `user`** เพราะมี 10 repo ที่ insert ลง `user` ตอน Firebase login ครั้งแรก ถ้าจำเป็นต้องใส่ default ฝั่ง DB
- [ ] ถ้าใช้ `DEFAULT (uuid())` บน RDS MySQL 8.4 ต้องเพิ่มคอลัมน์เป็น nullable ก่อน, backfill แล้วค่อย `MODIFY` (error 1674)
- [ ] ถ้าใช้ทั้ง Privy และ thirdweb ระหว่างเปลี่ยนผ่าน ต้องกำหนดว่า wallet ไหนเป็น wallet หลักของผู้ใช้ address ของสอง provider ไม่ตรงกัน เพราะ key คนละชุด

### Frontend

- [ ] pin `thirdweb` ไว้ที่ version ที่ทดสอบแล้ว (POC ใช้ `5.121.6`)
- [ ] ใช้ `inAppWallet({ executionMode: { mode: 'EIP7702', sponsorGas: true } })` และ `connect({ strategy: 'jwt' })` เรียก sync ทุกครั้งหลัง connect
- [ ] แสดงข้อความที่เข้าใจง่ายเมื่อ verifier ปฏิเสธ เช่น "รายการนี้ไม่รองรับการชำระค่า gas แทน" และแจ้งว่าผู้ใช้ต้องมี RON สำหรับราคาสินค้า
- [ ] ลิงก์ explorer ไปที่ address หรือ event ของผู้ใช้ ไม่ใช่ `tx.from`

### การทดสอบก่อนเปิดใช้

- [ ] ใส่ `THIRDWEB_SECRET_KEY` แล้วทดสอบ sync กับ API จริง
- [ ] ทดสอบ verifier ในโหมด 7702 ด้วยปุ่มทั้ง 3 ปุ่ม และดูว่ามี log `[sponsor]` จริง
- [ ] ทดสอบซื้อจริงบน mainnet ด้วยวงเงินต่ำ เทียบผลกับการจำลองด้วย `eth_call`
- [ ] ทดสอบกรณี verifier ล่มหรือ timeout

## อ้างอิง

- [thirdweb Custom auth (JWT)](https://portal.thirdweb.com/wallets/custom-auth)
- [thirdweb Sponsorship policies / server verifier](https://portal.thirdweb.com/wallets/sponsorship-policies)
- [thirdweb Enable gasless](https://portal.thirdweb.com/react/v5/in-app-wallet/enable-gasless)
- [thirdweb Get user details on the server](https://portal.thirdweb.com/connect/in-app-wallet/guides/get-user-details)
- [thirdweb Pregenerate wallets](https://portal.thirdweb.com/wallets/pregenerate-wallets)
- [thirdweb Dedicated Relayer](https://portal.thirdweb.com/wallets/dedicated-relayer)
- [Ronin Feather Fan / Kotaro upgrade (EIP-7702)](https://blog.roninchain.com/p/feather-fan-upgrade)
- [`@sky-mavis/mavis-market-core`](https://www.npmjs.com/package/@sky-mavis/mavis-market-core)
