# 🗺️ Chat Dev MCP Roadmap & High-Efficiency Spec (V2 Backlog)

เอกสารบันทึกแผนงานและสถาปัตยกรรมระดับสูงที่ออกแบบมาเพื่อ **เร็วขึ้น (Faster) + Token น้อยลง (Token Efficiency) + ปลอดภัยสูงสุด (Zero Source Corruption)**

---

## 🎯 Top 5 High-Leverage Priorities (Focus First)

1. **PTY Support for `codexRun`** (Pseudo-Terminal for Local CLI Agents)
2. **`getProjectSnapshot`** (1-Call Startup with Instruction Content-Hashing)
3. **Semantic Code Reader (`readSymbol`, `listSymbols`, `findReferences`)** (AST-based extraction)
4. **Smart Test Runner (`testChanged`) + Compact Structured Diagnostics** (Impact-based testing)
5. **Git Worktree & Semantic Branch Management (`compareBranches`, `syncStatus`, `listWorktrees`)**

---

## 📋 Full Prioritized Feature Backlog

### 🔴 P0 — คุ้มค่าสูงสุด ลดความเสี่ยง และทลายคอขวด
* **1. `codexRun` with True PTY**: รองรับ ConPTY บน Windows (`node-pty`) แก้ปัญหา `stdin is not a terminal`
* **2. `getProjectSnapshot`**: รวบ 5 คำสั่ง startup เหลือ 1 call (Branch, Head, Dirty, Handoff, Instruction Hash)
* **3. Semantic Code Reader**: `readSymbol`, `listSymbols`, `findReferences` (ดึงเฉพาะ Method/Class แทนอ่านทั้งไฟล์ 400 บรรทัด)
* **4. Guarded `applyPatch` with Auto-Verification**: ตรวจสอบ SHA256 Hash ก่อน/หลัง และรับประกัน Unchanged Regions 100%

### 🟡 P1 — เร่งความเร็ว Coding & Verification Loop
* **5. Smart `testChanged`**: คัดกรองเฉพาะ Test Suites ที่กระทบจาก Git Diff (.NET xUnit / Vitest / Vue-tsc)
* **6. Compact Structured Diagnostics**: กรอง MSBuild/TSC Output เหลือเฉพาะ Error และ New Warnings (ข้าม Baseline warnings)
* **7. Semantic Branch Comparison (`compareBranches`, `syncStatus`)**: Ahead/Behind, CommitsOnly, MergeBase ใน Call เดียว
* **8. Worktree-Aware Operations (`listWorktrees`, `inspectWorktree`)**: ป้องกัน Session เหยียบไฟล์กันข้าม Worktree

### 🟢 P2 — ลด Token สำหรับ Review & Repositories ขนาดใหญ่
* **9. Code-Aware `diffSummary`**: สรุปการเปลี่ยนแปลงเชิง Architecture และ Risk Areas (Auth, Transaction, Migration)
* **10. Grouped `semanticSearch` / Context Snippets**: รวมผลการค้นหาตาม Symbol/File พร้อม Context Lines 3 บรรทัด
* **11. Repo Knowledge Index / `traceFeature`**: แผนผังความสัมพันธ์ (Entity ↔ Coordinator ↔ API ↔ UI ↔ Tests)

### 🔵 P3 — Developer Quality of Life & Automation
* **12. Universal Tool Schema Consistency**: ทุก Tool รองรับ `project?` และ `cwd?` เหมือนกัน 100%
* **13. Non-Intrusive `writeHandoff`**: เก็บ State ฝั่ง Server เป็นค่าเริ่มต้น ไม่ทำให้ Git Working Tree สกปรก
* **14. PowerShell-Safe File Operations**: `deleteFile`, `moveFile`, `hashFile`, `compareFileContent` โดยไม่ต้องพึ่ง Shell
* **15. Atomic Branch-Close Workflow**: Merge, Test, Push, Delete Branch แบบมี Verification Gate อัตโนมัติ
