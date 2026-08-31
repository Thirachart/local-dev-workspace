# 📜 Engineering Contract & Requirements Specification (`chat-dev-mcp v2`)

เอกสารข้อกำหนดเชิงวิศวกรรมสำหรับ Model Context Protocol (MCP) Server ที่ออกแบบมาเพื่อ Coding Agents โดยยึดหลัก:
> **"Fail loudly, never silently corrupt, and expose uncertainty explicitly"** ภายใต้ **Deterministic Preconditions**

---

## 🎯 1. Core Engineering Principles

### 1.1 Determinism under Stated Preconditions
* เลิกใช้คำเคลมแบบเด็ดขาดว่า "ไม่มีทางผิดพลาด 100%"
* ทุก Tool ต้องระบุ Preconditions, Invariants, และ Failure Modes (เช่น Filesystem Race, Process Termination, Permission Denied, Torn State) ไว้อย่างชัดเจน

### 1.2 Optimistic Concurrency & Fingerprinting (CAS)
* ทุกการร้องขอการอ่านสถานะ ต้องคืนค่า `snapshotFingerprint` (Git HEAD SHA + Index Tree SHA + Rules Hash)
* คำสั่งแก้ไขไฟล์ (`edit_file`, `apply_patch`) ต้องรับ `expected_before_hash` หากเนื้อหาบนดิสก์ไม่ตรงกับ Hash ที่คาดหวัง ต้องปฏิเสธทันทีด้วยรหัส `CONCURRENCY_CONFLICT`

### 1.3 Atomic File Write Pipeline
* **Step 1**: คำนวณ SHA256 ของไฟล์ปัจจุบัน และตรวจสอบกับ `expectedBeforeHash`
* **Step 2**: ดำเนินการ Patch ในหน่วยความจำ พร้อม Auto-detect Newline (`CRLF` vs `LF`)
* **Step 3**: ตรวจสอบความสมบูรณ์แบบ Bit-for-bit (`before + replacement + after === original`)
* **Step 4**: เขียนไฟล์ชั่วคราว `.tmp` **ในไดเรกทอรีเดียวกันเสมอ** (`path.join(path.dirname(fullPath), .tmp...)`) เพื่อการันตีว่าจะไม่มีปัญหา Cross-Volume Rename
* **Step 5**: เรียก `filehandle.sync()` (`fsync`) เพื่อ Flush ข้อมูลลงดิสก์จริงก่อน
* **Step 6**: เรียก `fs.rename` สลับไฟล์อย่างปลอดภัยแบบ Atomic

### 1.4 Never Swallow Errors Silently
* Tool สำหรับ Compiler/Build Diagnostics (`build_diagnostics`) ต้องคืนค่าทั้ง `parsedDiagnostics` และ `unparsedRelevantLines` (เก็บบรรทัดที่มี `error`, `fatal`, `exception`, `failed`) เพื่อไม่ให้ข้อผิดพลาดรูปแบบใหม่ถูกกลืนหายไป

### 1.5 Non-Intrusive Server State
* การบันทึก Session Handoff ต้องใช้ `persist="server"` เป็นค่าเริ่มต้น โดยเก็บใน `.chat-dev/handoff.json` ไม่สร้างไฟล์ขยะใน Git Working Tree โดยไม่ได้รับคำสั่งแบบ `persist="workspace"`

---

## 🛠️ 2. Comprehensive Tool Specifications (P0–P3)

### 🔴 P0 — Core Efficiency & Safety
1. **`codex_run`**: Spawn CLI process ภายใน Virtual Terminal จริง (ConPTY บน Windows / PTY บน Unix)
2. **`get_project_snapshot`**: รวมสถานะ Git, HEAD, Dirty, Commits, Rules Hash และ Handoff ใน 1 Call (Hash-Guarded)
3. **`list_symbols` & `read_symbol`**: สกัดสารบัญและโค้ดของ Method/Class ผ่าน TypeScript Compiler API และ `@vue/compiler-sfc`
4. **`find_references`**: ค้นหาจุดเรียกใช้งาน Symbol ทั่วทั้งโปรเจกต์
5. **Guarded `apply_patch` / `edit_file`**: ปรับแต่งไฟล์ด้วย CAS, Newline Normalization, และ Fsync Atomic Replace

### 🟡 P1 — Speeding up Coding Loop
6. **`build_diagnostics`**: รัน MSBuild / TSC และคืน Structured Diagnostics พร้อม Unparsed Lines
7. **`compare_branches`**: คำนวณ Merge-Base, Ahead/Behind, Commits Diff, และ File Changes
8. **`git_sync_status`**: ตรวจสอบสถานะ Upstream Sync พร้อมคืน `snapshotFingerprint`
9. **`list_worktrees`**: อ่านรายการ Git Worktrees ทั้งหมดแบบ Porcelain

### 🟢 P2 — Token Efficiency for Large Repos
10. **`summarize_diff`**: สรุปการเปลี่ยนแปลงเชิง Architecture และ Risk Areas (Transaction, Auth, Migrations)
11. **`search_context`**: ค้นหาข้อความแบบ Grouped by File พร้อม Context Lines 3 บรรทัด

### 🔵 P3 — Safe Operations & Automation
12. **`write_handoff`**: รองรับ `persist: "server" | "workspace"`
13. **Safe File Ops**: `delete_file`, `move_file`, `hash_file`, `compare_file_content`
14. **`close_feature_branch`**: รวม 8 ขั้นตอนการปิด Branch เข้าด้วยกัน พร้อมหยุดอัตโนมัติหาก Test ไม่ผ่าน
