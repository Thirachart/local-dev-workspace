# Local Dev Tool MCP Server (`local-dev-tool-mcp`)

**local-dev-tool-mcp** เป็น Model Context Protocol (MCP) Server ที่พัฒนาด้วย **Node.js / TypeScript** ออกแบบมาเพื่อให้ **ChatGPT**, **Claude Desktop**, **Claude Code**, **Cursor**, **Windsurf** หรือ Coding Agent ใดๆ สามารถเรียกใช้ Tools เพื่อพัฒนาโปรแกรมบนเครื่อง Local ได้อย่างเต็มรูปแบบ เช่น อ่าน/เขียน/แก้ไขโค้ด, รันคำสั่ง Terminal, ตรวจสอบสถานะ Background Task, ค้นหาไฟล์ และจัดการ Git เสมือนมีผู้ช่วยระดับ Codex หรือ Claude Code ในเครื่องของคุณ

---

## ✨ Features & Capabilities

- ⚡ **MCP-Native Primary Transport**: ใช้ MCP stdio เป็น local/CLI path หลัก และสำหรับ ChatGPT ให้เชื่อม local/private MCP ผ่าน **Secure MCP Tunnel**; HTTP/SSE/OpenAPI เดิมคงไว้เป็น compatibility path
- 📝 **Agentic File Editing**:
  - `read_file`: อ่านไฟล์พร้อมระบุช่วงบรรทัด (`start_line`, `end_line`) เพื่อประหยัด Token Context
  - `write_file`: สร้างไฟล์ใหม่ หรือเขียนทับทั้งไฟล์
  - `edit_file`: ค้นหาและแทนที่ข้อความเฉพาะจุด (Search & Replace) อย่างแม่นยำ
  - `list_directory`: แสดงรายการไฟล์/โฟลเดอร์ พร้อมขนาด
  - `delete_file`: ลบไฟล์หรือโฟลเดอร์
- 🔍 **Fast Code Search**:
  - `search_files`: ค้นหาข้อความ/Regex ใน Codebase (Grep-like) พร้อม line number & snippet
  - `find_files`: ค้นหาไฟล์ตาม Glob Pattern (เช่น `**/*.tsx`, `src/**/*.ts`)
- 💻 **Smart Terminal Execution**:
  - `run_command`: รันคำสั่ง Shell อัตโนมัติ (PowerShell บน Windows, Bash บน macOS/Linux) พร้อม Timeout
  - รองรับโหมด **Background Daemon** (`is_daemon: true`) สำหรับคำสั่ง long-running เช่น `npm run dev`
  - `task_status`: ตรวจสอบสถานะและอ่าน Logs ล่าสุดของ Background Task
  - `task_list`: ดูรายการ Background Tasks ทั้งหมด
  - `task_kill`: สั่งหยุดคำสั่ง Background Task
- 🌿 **Git Integration**:
  - `git_status`: สรุปสถานะการแก้ไขไฟล์และ Branch ปัจจุบัน
  - `git_diff`: ดู Git Diff ของการแก้ไขที่ยังไม่ได้ Commit

---

## 🚀 Getting Started

### 1. ติดตั้ง Dependencies และ Build

```bash
cd d:/labs/chat-dev-mcp
npm install
npm run build
```

---

## ⚙️ วิธีการเชื่อมต่อ (Configuration Guides)

### 1. 🟣 Claude Desktop (Stdio Mode)

เพิ่มการตั้งค่าในไฟล์ `claude_desktop_config.json`:
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "chat-dev": {
      "command": "node",
      "args": [
        "D:/labs/chat-dev-mcp/dist/index.js",
        "--cwd",
        "D:/labs/your-project-folder"
      ]
    }
  }
}
```

---

### 2. 🟢 Claude Code CLI / Cursor / Windsurf

สามารถเพิ่มในไฟล์ MCP Config ของ Cursor หรือรันผ่าน CLI:

```json
{
  "mcpServers": {
    "chat-dev": {
      "command": "node",
      "args": ["D:/labs/chat-dev-mcp/dist/index.js"]
    }
  }
}
```

---

### 3. 🌐 ChatGPT (MCP-Native + Secure MCP Tunnel)

ChatGPT เชื่อมกับ remote MCP server; หาก MCP server อยู่บนเครื่อง developer/private network ให้ใช้ **Secure MCP Tunnel** เป็น primary path เพื่อเชื่อม local MCP โดยไม่ต้อง expose server เป็น public HTTP endpoint โดยตรง

สำหรับ client รุ่นเก่าหรือการทดสอบ compatibility ยังสามารถใช้ HTTP/SSE เดิมได้:

```bash
npm run start:sse
# หรือ
node dist/index.js --sse --port 3001 --cwd "D:/labs/your-project"
```

Ngrok/OpenAPI paths ใน repository นี้ถือเป็น **legacy/compatibility transports** ไม่ใช่ architecture constraint ของ MCP v2 และจำนวน OpenAPI operations ไม่ถูกใช้กำหนด public MCP tool design

---

## 🛠️ CLI Options

| Option | Shorthand | Description | Default |
| :--- | :--- | :--- | :--- |
| `--sse` | | รันในโหมด HTTP / Server-Sent Events | Stdio mode |
| `--ngrok [token]` | | เปิด HTTP mode และส่ง Ngrok token; Tunnel ที่ Auto-Start ยังยึดค่าจาก Dashboard | |
| `--reset-key` | | สร้าง Bearer API Key ใหม่ | |
| `--port` | `-p` | พอร์ตสำหรับ SSE Server | `3001` |
| `--host` | | โฮสต์สำหรับ SSE Server | `localhost` |
| `--cwd` | `-d` | ไดเรกทอรีทำงานหลักสำหรับ File & Command Operations | `process.cwd()` |
| `--help` | `-h` | แสดงวิธีใช้งานคำสั่ง CLI | |

### 🔐 Tunnel Credentials

ห้ามฝัง token จริงไว้ใน source code หรือ example files ใช้ environment variable เช่น `NGROK_AUTHTOKEN` หรือบันทึกผ่าน local dashboard แทน โดย `config/auth.json` และ `.env` ถูก ignore จาก Git อยู่แล้ว ตัวอย่างตัวแปรดูได้จาก `.env.example`

> หาก token เคยถูก commit หรือเผยแพร่ใน source ให้ revoke/rotate token ที่ provider เพราะการลบออกจาก commit ล่าสุดไม่ได้ลบค่าจาก Git history เดิม

---

## 📚 Architecture & Working Flow

ดู workflow ของ AI Agent, service architecture, skills on-demand, security rules และ verification checklist ที่ [`docs/WORKFLOW.md`](docs/WORKFLOW.md)

---

## 🧪 การรัน Integration Tests

```bash
npm run test:integration
```

---

## 📄 License
MIT
