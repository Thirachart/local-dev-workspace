# 🗺️ Project Roadmap & Phase 2 Plans

บันทึกรายการฟีเจอร์และ Tools ที่เตรียมพัฒนาใน **Phase 2** เพื่อขยายขีดความสามารถของ `chat-dev-mcp`:

---

## 📌 Phase 2 Feature Backlog

1. **🌐 Web & Documentation Fetcher**:
   - `fetch_web_page`: ดึงเนื้อหาเว็บและ Documentations ของ Library ต่างๆ แปลง HTML เป็น Markdown ให้อัตโนมัติ (เทียบเท่า `WebFetch` ใน Claude Code)

2. **✂️ Advanced Multi-Block File Editor**:
   - `apply_patch` / `multi_edit_file`: แก้ไขหลายบล็อกพร้อมกันในไฟล์เดียว หรือรับ Unified Diff มา Apply เข้าไฟล์โดยตรง

3. **📁 File System Enhancements**:
   - `move_file` / `rename_file`: ย้ายหรือเปลี่ยนชื่อไฟล์และไดเรกทอรี

4. **📋 Agent Planning & Todo Management**:
   - `todo_list`, `todo_update`, `todo_clear`: ระบบ Checklist สำหรับจัดการ Plan และ Track Progress งานที่ซับซ้อนหลายขั้นตอน (เทียบเท่า `TodoRead` / `TodoWrite` ใน Claude Code)

5. **🔍 System & Environment Diagnostics**:
   - `get_environment_info`: ตรวจสอบสภาพแวดล้อมของเครื่อง (Node, Python, Go, Rust, Git, OS Version, PATH)

6. **📓 Jupyter Notebook Support**:
   - `read_notebook`, `edit_notebook_cell`: อ่านและแก้ไขโค้ดในไฟล์ `.ipynb` ทีละ Cell

---

*บันทึกข้อมูล ณ วันที่: 15 สิงหาคม 2026*
