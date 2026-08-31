# 🔄 Session Handoff & Tasks (2026-08-16 17:54:31)

## 📌 Session Summary
อัปเดต docs/WORKFLOW.md ให้ขั้น Verify เป็น stack-aware แทนการ fix คำสั่ง Node.js: เพิ่ม Detect Project Stack, inspect project commands, เลือก Build/Lint/Type Check/Test ตามภาษา+framework+tooling+ประเภทการเปลี่ยนแปลง, เพิ่มตัวอย่างสำหรับ Node/TS, Python, Go, Rust, Java, .NET, PHP, frontend และ Docker/IaC และคง verification เฉพาะ chat-dev-mcp เป็น npm run build + npm run test:integration + git diff --check. อัปเดต verification checklist ให้ generic ขึ้น. git diff --check ผ่าน.

## 📋 Next Steps / TODOs for Next Session
- [ ] Revoke/rotate Ngrok token เดิมที่ Ngrok provider/dashboard เพราะ token เคยอยู่ใน tracked source/Git history; จากนั้นใส่ token ใหม่ผ่าน NGROK_AUTHTOKEN หรือ local dashboard.
- [ ] ถ้า repository เคย push ไป remote ให้พิจารณา secret scanning และ Git history cleanup ตามนโยบายทีม; ยังไม่ได้ rewrite history เพราะเป็นการเปลี่ยนแปลงแบบ destructive.
- [ ] พิจารณาเพิ่ม automated stack detection/verification skill ใน .skills/ เพื่อให้ AI เลือก verification commands อัตโนมัติจาก repository metadata.
