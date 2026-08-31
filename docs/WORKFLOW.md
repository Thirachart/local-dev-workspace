# Chat Dev MCP — Architecture & Working Flow

เอกสารนี้สรุปโครงสร้างระบบและ flow มาตรฐานสำหรับ AI Agent ที่ทำงานกับ `chat-dev-mcp` เพื่อให้การอ่าน/แก้ไขโค้ด การรันคำสั่ง และการส่งต่องานทำได้อย่างสม่ำเสมอและปลอดภัย

## 1. System Architecture

```text
┌──────────────────────────┐
│ User / AI Agent          │
│ ChatGPT / Claude / Codex │
└─────────────┬────────────┘
              │
              ▼
┌──────────────────────────┐
│ Transport                │
│ • SSE / HTTP             │
│ • Stdio                  │
└─────────────┬────────────┘
              │
              ▼
┌──────────────────────────┐
│ Authentication           │
│ AuthService              │
│ HTTP → Bearer API Key    │
└─────────────┬────────────┘
              │
              ▼
┌──────────────────────────┐
│ Project Resolution       │
│ ProjectService           │
│ • Active Project         │
│ • Session Isolation      │
│ • Permissions            │
└─────────────┬────────────┘
              │
              ▼
┌──────────────────────────┐
│ MCP Tool Router          │
│ src/tools/index.ts       │
└─────────────┬────────────┘
              │
      ┌───────┼────────┬─────────┬──────────┐
      ▼       ▼        ▼         ▼          ▼
    File    Search   Process     Git      Memory
  Service  Service  Service   Service   Service
      │       │        │         │          │
      └───────┴────────┴─────────┴──────────┘
                       │
                       ▼
             ┌────────────────────┐
             │ Active Workspace   │
             │ + Path Jail        │
             └──────────┬─────────┘
                        │
                        ▼
               ┌─────────────────┐
               │ Tool Result     │
               └────────┬────────┘
                        │
                        ▼
                 AI Agent / User
```

### Core Services

- `ProjectService` — project registry, active project และ session isolation
- `FileService` — อ่าน/เขียน/แก้ไขไฟล์ภายใต้ workspace boundary
- `SearchService` — grep/search และ glob file discovery
- `ProcessService` — shell command และ daemon/background process
- `GitService` — Git status และ diff
- `MemoryService` — project instructions และ session handoff
- `AuthService` — Bearer API key
- `NgrokService` — Ngrok tunnel และ local token storage
- `src/tools/index.ts` — จุดรวม MCP tools
- `src/transports/sse.ts` / `src/transports/stdio.ts` — transport layer

## 2. Standard AI Agent Workflow

```text
1. รับ Task
      ↓
2. ตรวจ Active Project
      ↓
3. อ่าน AGENTS.md / CLAUDE.md
      ↓
4. อ่าน HANDOFF.md ถ้ามี
      ↓
5. ตรวจ Skills ที่ใช้งานได้
      │
      ├─ มี skill ที่ตรงงาน
      │      ↓
      │   readSkill()
      │      ↓
      │   ทำตาม runbook
      │
      └─ ไม่มี
             ↓
        ใช้ workflow ปกติ
      ↓
6. สำรวจโค้ดที่เกี่ยวข้อง
   listDirectory / findFiles / searchFiles / readFile
      ↓
7. วางแนวทางแก้ไข
      ↓
8. แก้ Code
   editFile / writeFile
      ↓
9. Verify
   Detect Project Stack
      ↓
   เลือก Build / Lint / Type Check / Test
   ตามภาษา + framework + tooling + ประเภทการเปลี่ยนแปลง
      ↓
10. ตรวจผลกระทบ
    gitStatus / gitDiff
      ↓
11. บันทึก Handoff เมื่อจบ milestone
      ↓
12. สรุปสิ่งที่แก้ + ผลทดสอบให้ User
```

### Operating Rules

1. ใช้ relative path ภายใน active workspace เท่านั้น
2. อ่าน project instructions ก่อนแก้โค้ด
3. ไม่เขียนหรือ execute สิ่งใดออกนอก workspace boundary
4. แก้เฉพาะไฟล์ที่เกี่ยวข้องกับ task และหลีกเลี่ยงการทับงานที่ user มีอยู่แล้ว
5. หลังแก้โค้ดต้อง verify ตาม stack และประเภทการเปลี่ยนแปลงของโปรเจกต์
6. ตรวจ Git diff ก่อนสรุปผล
7. เมื่อจบ milestone หรือ context เริ่มยาว ให้บันทึก `HANDOFF.md`

### Stack-Aware Verification Strategy

ขั้น Verify ต้องไม่ผูกกับคำสั่งของภาษาใดภาษาหนึ่ง ให้ตรวจ stack ของ repository ก่อน แล้วเลือก checks ที่โปรเจกต์รองรับจริง

```text
Verify
  ↓
Detect Project Stack
  │
  ├─ package.json       → Node.js / JavaScript / TypeScript
  ├─ pyproject.toml     → Python
  ├─ go.mod             → Go
  ├─ Cargo.toml         → Rust
  ├─ pom.xml / build.gradle → Java / JVM
  ├─ *.csproj / *.sln   → .NET
  └─ อื่น ๆ             → อ่าน project instructions / CI config
  ↓
Inspect Project Commands
  ↓
เลือก checks ตามความเหมาะสม
  ├─ Build / Compile
  ├─ Lint / Format Check
  ├─ Type Check / Static Analysis
  └─ Unit / Integration / E2E Tests
  ↓
Verification Result
  ├─ PASS → ตรวจ Git diff และสรุปผล
  └─ FAIL → วิเคราะห์สาเหตุ แก้ไข และ Verify ซ้ำ
```

ตัวอย่าง verification commands ที่พบบ่อย:

| Stack | ตัวอย่าง Checks |
| --- | --- |
| Node.js / TypeScript | `npm run build`, `npm test`, `tsc`, ESLint |
| Python | `pytest`, `ruff check`, `mypy` หรือ `pyright` |
| Go | `go build ./...`, `go test ./...`, `go vet ./...` |
| Rust | `cargo check`, `cargo test`, `cargo clippy` |
| Java | `mvn test`, `mvn verify`, `gradle test` |
| .NET / C# | `dotnet build`, `dotnet test` |
| PHP | PHPUnit, PHPStan หรือ Psalm |
| Frontend | lint + typecheck + unit tests + production build |
| Docker / IaC | config validation, `docker compose config`, Terraform validate/plan ตาม task |

คำสั่งจริงต้องอิงจาก `AGENTS.md` / `CLAUDE.md`, scripts ใน repository และ CI configuration ก่อนใช้ตัวอย่างจากตารางเสมอ

สำหรับ `chat-dev-mcp` ปัจจุบัน verification หลักคือ:

```text
npm run build
npm run test:integration
git diff --check
```

ทั้งนี้อาจเพิ่ม check อื่นเมื่อประเภทการเปลี่ยนแปลงต้องการ เช่น security regression, HTTP endpoint behavior หรือ platform-specific build

## 3. Skills On-Demand Flow

```text
Task
  ↓
listSkills()
  ↓
เลือก skill ที่เกี่ยวข้อง
  ↓
readSkill("skill-name")
  ↓
โหลด instructions / runbook
  ↓
ใช้ MCP tools ทำงาน
  ↓
Verify
  ↓
Result
```

แนวทางนี้ช่วยไม่ให้ context ใหญ่เกินจำเป็น เพราะจะโหลด skill เฉพาะตอนที่ task ต้องใช้เท่านั้น เช่น debugging, testing, architecture หรือ deployment

> ปัจจุบัน workspace นี้เปิดใช้ระบบ skills แล้ว แต่ยังไม่มี specialized skill ที่ register อยู่ใน `.skills/`

## 4. Credential & Tunnel Security

### Ngrok token resolution

เมื่อเริ่ม Ngrok ระบบใช้ token ตามลำดับความสำคัญดังนี้:

1. token ที่ระบุผ่าน `--ngrok <token>`
2. environment variable `NGROK_AUTHTOKEN`
3. token ที่บันทึกไว้ใน local `config/auth.json`

ห้ามมี default/fallback token ฝังอยู่ใน source code

### Local credential files

- `config/auth.json` เป็น local credential store และต้องไม่ถูก commit
- `.gitignore` ต้องมี `config/auth.json`
- `.env` และ `.env.*` ต้องไม่ถูก commit ยกเว้น `.env.example`
- ห้ามใส่ token จริงใน README, source code, test fixture หรือ example file

ตัวอย่าง environment variables ดูได้ที่ `.env.example`

### Exposed token response

หาก token เคยถูก commit หรือเผยแพร่ใน source code ให้ถือว่า token นั้น compromised แม้จะลบออกจาก commit ล่าสุดแล้ว เพราะอาจยังอยู่ใน Git history

สิ่งที่ต้องทำ:

1. revoke/rotate token จาก provider (เช่น Ngrok Dashboard)
2. ใส่ token ใหม่ผ่าน environment variable หรือ local dashboard
3. ตรวจ repository ว่าไม่มี token เดิมหลงเหลือใน tracked files
4. ถ้า repository เคยถูก push ไป remote ให้พิจารณา secret scanning และ history cleanup ตามนโยบายของทีม

## 5. Verification Checklist

หลังแก้ไขระบบหรือเพิ่ม feature ให้ตรวจอย่างน้อย:

- [ ] ตรวจพบ project stack / framework / tooling ที่เกี่ยวข้องแล้ว
- [ ] รัน build / compile / lint / type check / tests ที่ repository กำหนดและเกี่ยวข้องกับการเปลี่ยนแปลง
- [ ] สำหรับ `chat-dev-mcp`: `npm run build` และ `npm run test:integration` ผ่าน
- [ ] ไม่มี credential/token ฝังใน tracked source files
- [ ] ไม่มี absolute host path หลุดใน API/tool response
- [ ] file/process operations ยังถูกจำกัดใน active workspace
- [ ] HTTP API ที่ต้องป้องกันยังตรวจ Bearer API key
- [ ] Local dashboard/UI APIs ยังจำกัด localhost ตาม architecture
- [ ] `git diff` มีเฉพาะการเปลี่ยนแปลงที่ตั้งใจ

## 6. Session Handoff

เมื่อจบ milestone ให้ handoff มีอย่างน้อย:

- สิ่งที่ทำเสร็จแล้ว
- ไฟล์สำคัญที่เปลี่ยน
- ผล build/test
- ความเสี่ยงหรือข้อจำกัดที่ยังเหลือ
- TODO / next steps สำหรับ session ถัดไป
