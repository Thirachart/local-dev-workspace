# Local Dev Tool MCP Server (`local-dev-tool-mcp`)

**local-dev-tool-mcp** เป็น Model Context Protocol (MCP) Server ที่พัฒนาด้วย **Node.js / TypeScript** ออกแบบมาเพื่อให้ **ChatGPT**, **Claude Desktop**, **Claude Code**, **Cursor**, **Windsurf** หรือ Coding Agent ใดๆ สามารถเรียกใช้ Tools เพื่อพัฒนาโปรแกรมบนเครื่อง Local ได้อย่างเต็มรูปแบบ เช่น อ่าน/เขียน/แก้ไขโค้ด, รันคำสั่ง Terminal, ตรวจสอบสถานะ Background Task, ค้นหาไฟล์ และจัดการ Git เสมือนมีผู้ช่วยระดับ Codex หรือ Claude Code ในเครื่องของคุณ

---

## ✨ Features & Capabilities

- ⚡ **MCP-Native Primary Transport**: ใช้ MCP stdio เป็น local/CLI path หลัก และสำหรับ ChatGPT ให้เชื่อม local/private MCP ผ่าน **Secure MCP Tunnel**; HTTP/SSE/OpenAPI เดิมคงไว้เป็น compatibility path
- 📝 **Safe & Reversible File Editing**:
  - `read_file`: อ่านไฟล์พร้อมระบุช่วงบรรทัด (`start_line`, `end_line`) เพื่อประหยัด Token Context
  - `write_file`: atomic write โดยไฟล์เดิมต้องใช้ `replace_if_hash` หรือ `force` อย่างชัดเจน
  - `edit_file` / `apply_patch`: แก้ไขเฉพาะจุดพร้อม snapshot/CAS guard
  - `undo_operation` / `get_mutation`: ย้อน file mutation ที่บันทึกไว้ โดย refuse ทันทีหากไฟล์ถูกแก้หลัง mutation
  - `file_changeset`: รวม write/edit/delete/move/patch แบบ file-only และ rollback อัตโนมัติเมื่อ operation ใดล้มเหลว
  - `copy_file` / `sync_file`: คัดลอกไฟล์ข้าม project แบบ explicit source/target พร้อมตรวจ SHA256 ได้
  - `patch_json` / `patch_yaml`: แก้ config แบบ structured ด้วย JSON Pointer
  - `batch_file_ops`: batch read/hash/compare เพื่อลด round trips
- 🔍 **Fast Code Search**:
  - `search_files`: ค้นหาข้อความ/Regex ใน Codebase (Grep-like) พร้อม line number & snippet
  - `find_files`: ค้นหาไฟล์ตาม Glob Pattern (เช่น `**/*.tsx`, `src/**/*.ts`)
- 💻 **Smart Terminal & Process Execution**:
  - `run_command`: รัน trusted shell (PowerShell บน Windows, Bash บน macOS/Linux) พร้อม timeout; foreground timeout จะ terminate process โดย default
  - ใช้ `detach_on_timeout: true` เฉพาะเมื่อต้องการให้ process ที่ timeout ทำงานต่อเป็น background task
  - รองรับ **Background Daemon** (`is_daemon: true`) สำหรับ long-running process เช่น `npm run dev`
  - `process_manager`: canonical lifecycle API สำหรับ start/stop/restart/logs/list
  - `task_status`, `task_list`, `task_kill`: compatibility aliases สำหรับ client เดิม
  - การตรวจ command pattern เป็น defense in depth ไม่ใช่ hard sandbox; หากต้องการ hard isolation ต้องใช้ OS/process/container isolation
- 🌿 **Git Integration**:
  - `git_status`, `git_diff`, `git_log`: ตรวจสถานะ Diff และประวัติ
  - `git_commit`: guarded commit ที่ตรวจ workspace/Git observation ก่อน mutation
  - `git_stage` / `git_unstage`: stage/unstage ไฟล์แบบไม่ผ่าน shell interpolation
  - `git_show`: อ่านไฟล์ที่ revision โดยไม่ checkout
  - `git_branch`, `git_push`, `git_sync_status`: workflow และ remote synchronization
- 📁 **Project Registry Safety**:
  - `add_project` ลงทะเบียนเฉพาะ directory ที่มีอยู่จริง; `create_project` ใช้เมื่อจะสร้าง directory ใหม่โดยตั้งใจ
  - `project_registry_report` รายงาน missing/stale/duplicate-path entries โดยไม่เปิดเผย absolute path
  - `config/projects.json` เป็น machine-local และไม่ถูก commit; ใช้ `config/projects.example.json` เป็นตัวอย่าง

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
