# 🤖 Project Guidelines & Architecture (`local-dev-tool-mcp`)

## 📌 Project Overview
**Local Dev Tool MCP** (`local-dev-tool-mcp`) เป็น Model Context Protocol (MCP) Server พัฒนาด้วย **Node.js / TypeScript** ออกแบบมาเพื่อให้ AI Agents (ChatGPT, Claude Desktop, Claude Code, Cursor, Codex) สามารถควบคุมเครื่องมือพัฒนาโปรแกรมบนเครื่อง Local เช่น อ่าน/เขียน/แก้ไขโค้ด, รันคำสั่ง Terminal Shell, ค้นหาไฟล์, จัดการ Git และสลับพื้นที่ทำงานหลายโปรเจกต์พร้อมกัน

---

## 🛠️ Technology Stack & Commands
- **Runtime & Language**: Node.js (v18+), TypeScript 5.7+, ESM Module (`"type": "module"`)
- **Key Dependencies**: `@modelcontextprotocol/sdk`, `express`, `@ngrok/ngrok`, `cors`, `zod`, `tsup`, `tsx`
- **Build Commands**:
  - `npm run build` : Bundle TypeScript into ESM executable (`dist/index.js`) using `tsup`
  - `npm run build:app` : Compile native macOS Desktop Application (`ChatDevMCP.app`)
  - `npm run dev` : Execute development server directly via `tsx`
  - `npm start` : Run compiled bundle via `node dist/index.js`
  - `npm run start:ngrok` : Run SSE server with Ngrok tunnel on port 4100

---

## 🏗️ Architecture & Core Services
- **Transports**:
  - `src/transports/stdio.ts`: Stdio transport สำหรับ CLI (Claude Desktop / Claude Code)
  - `src/transports/sse.ts`: HTTP / Server-Sent Events transport สำหรับ Web & ChatGPT Custom GPT Actions
- **Service Layer Pattern**:
  - `FileService`: จัดการอ่าน/เขียน/แก้ไขไฟล์ พร้อมระบบ Path Jail
  - `SearchService`: Code Grep Search & Glob File Finder
  - `ProcessService`: ควบคุม Terminal Shell Processes (One-off / Background Daemons)
  - `GitService`: สรุป `git_status` และ `git_diff`
  - `ProjectService`: บริหารจัดการ Project Registry และ Session Isolation (`sessionActiveProjects`)
  - `AuthService`: จัดการ Bearer API Key ความปลอดภัย 100%
  - `NgrokService`: จัดการเปิด/ปิด Ngrok Public Tunnel On-demand
  - `MemoryService`: Auto-discovery ไฟล์กติกา (`AGENTS.md` / `CLAUDE.md`) และ On-demand Handoff (`.chat-dev/handoff.md`)

---

## 🛡️ Security & Conventions
1. **Localhost-Only UI Security**: หน้า Web Dashboard (`/`, `/dashboard`, `/logs`) และ API ภายใน (`/api/ui/*`) ถูกล็อกให้เข้าถึงได้เฉพาะจาก `localhost` (127.0.0.1) เท่านั้น เพื่อความปลอดภัยสูงสุด
2. **Bearer API Key**: ทุกการร้องขอผ่าน HTTP `/api/*` ต้องแนบ `Authorization: Bearer <API_KEY>`
3. **Workspace Boundary**: ห้ามทำหัตถการใดๆ ออกนอกขอบเขตโปรเจกต์ที่ลงทะเบียนไว้
4. **Session Isolation**: สลับโปรเจกต์แยกตาม `sessionId` ป้องกันการเหยียบกันระหว่างหน้าต่างแชท
5. **Handoff Convention**: รายการส่งต่องานระยะสั้น (Session Handoff) จะถูกบันทึกผ่าน Tool `write_handoff` โดยใช้ `persist: "server"` (`.chat-dev/handoff.md`, ค่าเริ่มต้นแบบไม่รบกวน Git working tree) หรือ `persist: "workspace"` (`HANDOFF.md` ใน root) หรือระบุ `path` เฉพาะเจาะจง โดยระบบจะ Auto-Discover ไฟล์ที่มีการแก้ไขล่าสุด (`mtime`) และคืนค่า `filePath` ที่บันทึกจริงกลับมาให้อัตโนมัติ
