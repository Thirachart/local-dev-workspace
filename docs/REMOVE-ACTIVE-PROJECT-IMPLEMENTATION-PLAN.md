# Remove Active Project Model - Implementation Plan

## Objective

เปลี่ยนระบบจาก workspace model ที่มี `activeProject` เป็น explicit project execution model โดยทุก project-scoped operation ต้องได้รับ `project` จาก caller เสมอ

เป้าหมาย:

- ไม่มี global/session active project state
- ไม่มี `switch_project`
- ทุก tool command ต้องระบุ project
- รองรับหลาย project พร้อมกัน

## Current Status

Last updated: 2026-08-19

Overall progress: ~95%

## Completed

- [x] เพิ่ม `getRequiredProject(project)`
- [x] เอา active project fallback ออกจาก permission flow
- [x] เอา active project fallback จาก process execution
- [x] Snapshot ต้องระบุ project
- [x] Linear ต้องระบุ project
- [x] file/process/workspace services หลักไม่พึ่ง active project
- [x] add_project ไม่มี make active
- [x] project list ไม่คืน active state
- [x] OpenAPI/SSE ลด active workflow

## Remaining Work

### Phase 1: MCP Tool Contract Migration

Status: Completed (final audit pending)

- [x] ทุก workspace tool ต้องมี `project: string`
- [x] ลบ `get_active_project`
- [x] ลบ `switch_project`
- [x] ตรวจ file/search/git/command/diagnostic tools

### Phase 2: Remove Project State Completely

Status: Completed

Remove:

- [x] `activeProjectId`
- [x] `sessionActiveProjects`
- [x] `isActive` project state
- [x] `getActiveProject()`
- [x] `setActiveProject()`

Target:

```
Operation
  |
project
  |
Project Resolver
  |
Execution
```

### Phase 3: Transport Cleanup

Status: Completed

- [x] remove `/api/get_active_project`
- [x] remove `/api/switch_project`
- [x] remove related handlers

### Phase 4: UI Cleanup

Status: Completed

Remove:

- [x] Active badge
- [x] Switch workspace UI
- [x] setActiveProject client flow

Replace with project registry view.

### Phase 5: Documentation and Agent Instructions

Status: In progress

Replace:

```
check active project
switch project before work
```

with:

```
Every project operation requires explicit project.
Never switch projects.
Multiple projects can be handled concurrently.
```

## Final Verification

- [ ] npm run build
- [ ] npm test
- [ ] grep runtime references

Target:

```
activeProject = 0
getActiveProject = 0
setActiveProject = 0
activeProjectId = 0
sessionActiveProjects = 0
switch_project = 0
get_active_project = 0
isActive = 0
```

## Commit Strategy

1. Remove active project dependency from services/tools
2. Remove active project API workflow
3. Remove active project MCP tools
4. Remove UI active workflow
5. Remove legacy state and finalize verification

## Final Architecture

```
Tool Call
    |
    | project="backend"
    v
Project Resolver
    |
Project Context
    |
+-- Files
+-- Git
+-- Commands
+-- Tests
```

No active project state exists.
