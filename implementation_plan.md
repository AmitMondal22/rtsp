# Implementation Plan: Bank & Branch Hierarchy, Device Assignment, RTSP WebSocket Streaming, and Enhanced User Roles

This document outlines technical specifications and steps to fulfill all user requirements:
1. **Bank & Branch Structure**: Implement Branch hierarchy under Bank with 3 assigned users, active status toggle, and 1st OTP / 2nd OTP user selection.
2. **Device Management**: Add Bank and Branch dropdown selection during Device creation and updates while preserving MQTT send/receive packet logic.
3. **RTSP Live Video WebSocket Streaming**: Connect RTSP streams in the backend and stream frames to the frontend via WebSockets (with MJPEG fallback).
4. **User Management**: Add full role management for `admin` and `super_admin`, active status tracking, and bank/branch assignment.

---

## User Review Required

> [!IMPORTANT]
> **Database Auto-Migration**: New model columns (`branch_id`, `is_active`, `user1_id`, `user2_id`, `user3_id`, `otp1_user_id`, `otp2_user_id`) will be auto-migrated on startup without breaking existing data.
> **MQTT Protocols Unchanged**: The `/OTP/{device_name}` MQTT topic and payload structure (`otp1`, `otp2`) remain completely untouched to preserve downstream device compatibility.

---

## Proposed Changes

### Database Models

#### [NEW] [branch.py](file:///d:/ipcamera/app/models/branch.py)
- Define `Branch` model: `id`, `name`, `bank_id` (FK to banks), `is_active` (Boolean), `user1_id`, `user2_id`, `user3_id`, `otp1_user_id`, `otp2_user_id`, `created_at`, `updated_at`.
- Establish ORM relationships with `Bank`, `User`, and `Device`.

#### [MODIFY] [bank.py](file:///d:/ipcamera/app/models/bank.py)
- Add `branches = relationship("Branch", back_populates="bank", cascade="all, delete-orphan")`.

#### [MODIFY] [user.py](file:///d:/ipcamera/app/models/user.py)
- Add `branch_id = Column(Integer, ForeignKey("branches.id"), nullable=True)`.
- Add `branch` relationship. Ensure roles `super_admin`, `admin`, `bank_admin`, `user` are fully supported.

#### [MODIFY] [device.py](file:///d:/ipcamera/app/models/device.py)
- Add `branch_id = Column(Integer, ForeignKey("branches.id"), nullable=True)`.
- Add `branch` relationship.

#### [MODIFY] [__init__.py](file:///d:/ipcamera/app/models/__init__.py)
- Export `Branch`.

---

### Backend Schemas & Controllers

#### [NEW] [branch.py](file:///d:/ipcamera/app/schemas/branch.py)
- Define Pydantic models: `BranchCreate`, `BranchUpdate`, `BranchOut` containing bank/branch metadata, assigned 3 user IDs, 1st OTP user ID, 2nd OTP user ID, and active status.

#### [MODIFY] [bank.py](file:///d:/ipcamera/app/schemas/bank.py)
- Update `BankOut` to include branch details.

#### [MODIFY] [user.py](file:///d:/ipcamera/app/schemas/user.py)
- Update `BankUserCreate`, `UserOut`, `UserUpdate` to include `branch_id`, `branch_name`, and `is_active`.

#### [MODIFY] [device.py](file:///d:/ipcamera/app/schemas/device.py)
- Update `DeviceCreate`, `DeviceUpdate`, `DeviceOut` to include `bank_id`, `branch_id`, `bank_name`, and `branch_name`.

#### [MODIFY] [bank_service.py](file:///d:/ipcamera/app/services/bank_service.py)
- Implement `create_branch_service`, `get_branches_service`, `update_branch_service`, `delete_branch_service`.

#### [MODIFY] [bank_controller.py](file:///d:/ipcamera/app/controllers/bank_controller.py)
- Expose REST API routes:
  - `POST /api/banks/branches`
  - `GET /api/banks/branches`
  - `GET /api/banks/{bank_id}/branches`
  - `PUT /api/banks/branches/{branch_id}`
  - `DELETE /api/banks/branches/{branch_id}`

#### [MODIFY] [device_controller.py](file:///d:/ipcamera/app/controllers/device_controller.py)
- Support creating/updating devices with both `bank_id` and `branch_id`.

#### [MODIFY] [camera_controller.py](file:///d:/ipcamera/app/controllers/camera_controller.py)
- Add WebSocket route `@router.websocket("/{device_id}/ws")`.
- Capture RTSP frames via `OpenCVCamera` and transmit binary JPEG frames over WebSocket connection.
- Handle token authentication via URL query string (`?token=...`).

#### [MODIFY] [main.py](file:///d:/ipcamera/app/main.py)
- Update `auto_migrate()` to execute SQL migrations for `branches` table and missing columns in `users` and `devices`.

---

### Frontend Templates & Scripts

#### [MODIFY] [banks.html](file:///d:/ipcamera/templates/banks.html) & [banks.js](file:///d:/ipcamera/static/banks.js)
- Add "Branch Management" section & table under Banks.
- Add "Add Branch" & "Edit Branch" modals:
  - Select Bank (dropdown)
  - Branch Name (text)
  - Active Status (checkbox/toggle)
  - Select 3 Users (User 1, User 2, User 3 dropdowns)
  - Select 1st OTP User & 2nd OTP User (dropdowns)
  - Save action.

#### [MODIFY] [users.html](file:///d:/ipcamera/templates/users.html) & [users.js](file:///d:/ipcamera/static/users.js)
- Update user registration/edit form to allow selecting role (`super_admin`, `admin`, `bank_admin`, `user`), active status, Bank, and Branch.
- Display Branch name and Active status badge in the user list table.

#### [MODIFY] [dashboard.html](file:///d:/ipcamera/templates/dashboard.html) & [app.js](file:///d:/ipcamera/static/app.js)
- Add "Select Bank" and "Select Branch" dropdowns in the Add/Edit Device modal/form.
- Dynamically filter Branch options when Bank is changed.
- Implement WebSocket client streaming (`startWebSocketStream`) connected to `/api/camera/{deviceId}/ws` rendering binary Blob frames directly into the feed element with MJPEG fallback.

---

## Verification Plan

### Automated Tests
- Run `python verify_integration.py` to verify bank, user creation, device creation with bank & branch assignment, and OTP operations.

### Manual Verification
- Test creating a Branch with 3 assigned users, active status, and 1st/2nd OTP user selection in `/banks`.
- Test creating a Device with Bank and Branch dropdown selection in `/dashboard`.
- Test live video streaming over WebSocket in `/dashboard`.
- Test User creation with Admin and Super Admin roles in `/users`.
