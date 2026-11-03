// ============================================================
// routes/auth.js - register (customer only) and login
// ============================================================
// POST /auth/register - public. self-registration creates a CUSTOMER.
// POST /auth/login    - public. returns a JWT for customer/teller/manager.

import { Router } from 'express';
import { z } from 'zod';
import { callProc, query, HttpError } from '../db.js';
import { hashPw, checkPw, makeToken } from '../auth.js';
import { parse } from '../validate.js';

const router = Router();

// Shape of a registration request
const registerSchema = z.object({
  cnic: z.string().regex(/^\d{13}$/, 'CNIC must be 13 digits, no dashes'),
  name: z.string().min(1),
  phone: z.string().min(1),
  email: z.string().email(),
  username: z.string().min(3),
  password: z.string().min(8),
});

router.post('/auth/register', async (req, res) => {
  const body = parse(registerSchema, req.body);
  // Hash the password in the BACKEND, then call the procedure.
  // rm_employee_id = null for self-registration (no assigned manager yet).
  await callProc('sp_register_customer', [
    body.cnic,
    body.name,
    body.phone,
    body.email,
    null,
    body.username,
    await hashPw(body.password),
  ]);
  res.status(201).json({ message: 'Registered' });
});

router.post('/auth/login', async (req, res) => {
  const body = parse(
    z.object({ username: z.string(), password: z.string() }),
    req.body
  );
  const [user] = await query('SELECT * FROM user_account WHERE username=?', [
    body.username,
  ]);
  // Note: SAME message for 'no such user', 'wrong password' AND 'disabled'
  // (so an attacker can't find out which usernames exist).
  if (!user || !user.is_active || !(await checkPw(body.password, user.password_hash))) {
    throw new HttpError(401, 'Invalid username or password');
  }
  res.json({ token: makeToken(user), role: user.role });
});

export default router;
