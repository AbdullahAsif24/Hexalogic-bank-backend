// ============================================================
// auth.js - passwords, tokens and permission checks
// ============================================================
// Three things happen here:
// 1. hashPw / checkPw   -> bcrypt password hashing (never store plain text)
// 2. makeToken          -> a JWT that says WHO is logged in (role, ids)
// 3. authenticate / requireRole / assertOwnsAccount
//    -> middleware that guard routes

import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { HttpError, query } from './db.js';

// ---------- 1. passwords ----------
export const hashPw = (plain) => bcrypt.hash(plain, 10); // 10 = cost factor
export const checkPw = (plain, hash) => bcrypt.compare(plain, hash);

// ---------- 2. tokens ----------
// The token stores:
//   sub        = user_id
//   role       = 'customer' | 'teller' | 'manager'
//   customerId = their customer id (customers only, else undefined)
//   employeeId = their employee id (staff only, else undefined)
export const makeToken = (user) =>
  jwt.sign(
    {
      sub: user.user_id,
      role: user.role,
      customerId: user.customer_id,
      employeeId: user.employee_id,
    },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );

// ---------- 3. route guards ----------
// authenticate: reads "Authorization: Bearer <token>" and puts
// the decoded token on req.user. Fails with 401 if token is bad.
export function authenticate(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    next();
  } catch {
    next(new HttpError(401, 'Invalid or expired token'));
  }
}

// requireRole('teller', 'manager'): allow only these roles.
export const requireRole = (...roles) => (req, _res, next) =>
  roles.includes(req.user.role)
    ? next()
    : next(new HttpError(403, 'Not allowed'));

// assertOwnsAccount: make sure a CUSTOMER only touches their own accounts.
// Staff (teller/manager) may act on any account.
export async function assertOwnsAccount(user, accountId) {
  if (user.role !== 'customer') return; // staff can act on any account
  const rows = await query(
    'SELECT 1 FROM customer_account WHERE customer_id=? AND account_id=?',
    [user.customerId, accountId]
  );
  if (rows.length === 0) throw new HttpError(403, 'This account does not belong to you');
}
