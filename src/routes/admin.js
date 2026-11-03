// ============================================================
// routes/admin.js - platform custody for the ADMIN role
// ============================================================
// Admin = staff logins + audit trail. Does NOT touch customer money.
// everything under /admin requires the 'admin' role.

import { Router } from 'express';
import { z } from 'zod';
import { callProc, query } from '../db.js';
import { authenticate, requireRole } from '../auth.js';
import { parse, id } from '../validate.js';

const router = Router();
const admin = [authenticate, requireRole('admin')];

// ---------- staff list: employees joined with their logins ----------
router.get('/admin/staff', admin, async (_req, res) => {
  const rows = await query(
    `SELECT e.employee_id, e.cnic, e.name, e.designation, e.email, e.branch_id,
            u.user_id, u.username, u.role, u.is_active
       FROM employee e
       LEFT JOIN user_account u ON u.employee_id = e.employee_id
      ORDER BY e.designation, e.name`
  );
  res.json(rows);
});

// ---------- create a staff login (tell/manager/admin) ----------
const createStaffSchema = z.object({
  cnic: z.string().regex(/^\d{13}$/, 'CNIC must be 13 digits, no dashes'),
  name: z.string().min(1),
  designation: z.enum(['Teller', 'Manager', 'Administrator']),
  email: z.string().email(),
  branchId: z.number().int().positive(),
  username: z.string().min(3),
  password: z.string().min(8),
});

router.post('/admin/staff', admin, async (req, res) => {
  const b = parse(createStaffSchema, req.body);
  const hash = (await import('bcrypt')).hash(b.password, 10);
  const rows = await callProc('sp_create_staff', [
    b.cnic,
    b.name,
    b.designation,
    b.email,
    b.branchId,
    b.username,
    await hash,
    req.user.employeeId, // the acting administrator, checked AGAIN inside the procedure
  ]);
  res.status(201).json({ message: 'Staff account created', ...rows[0] });
});

// ---------- enable / disable a login ----------
router.patch('/admin/users/:id', admin, async (req, res) => {
  const { isActive } = parse(z.object({ isActive: z.boolean() }), req.body);
  await callProc('sp_set_user_active', [
    id(req.params.id),
    isActive,
    req.user.employeeId,
  ]);
  res.json({ message: isActive ? 'Login enabled' : 'Login disabled' });
});

// ---------- reset a user's password (hash set here, never stored plain) ----------
router.post('/admin/users/:id/password', admin, async (req, res) => {
  const { password } = parse(z.object({ password: z.string().min(8) }), req.body);
  const hash = (await import('bcrypt')).hash(password, 10);
  await callProc('sp_reset_user_password', [id(req.params.id), await hash, req.user.employeeId]);
  res.json({ message: 'Password updated' });
});

// ---------- audit trail (most recent first, capped for safety) ----------
router.get('/admin/audit', admin, async (req, res) => {
  const q = parse(
    z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }),
    req.query
  );
  const rows = await query(
    `SELECT log_id, table_name, record_id, action, old_value, new_value, changed_at
       FROM audit_log ORDER BY log_id DESC LIMIT ?`,
    [q.limit]
  );
  res.json(rows);
});

export default router;
