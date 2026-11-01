// ============================================================
// db.js - the ONLY file that talks to MySQL
// ============================================================
// Two helpers that everything else uses:
//   callProc(name, args) -> runs CALL stored_procedure(args)
//   query(sql, args)     -> runs a SELECT (usually from a view)
//
// Important rules:
// - All business rules live in the DATABASE (procedures + triggers).
//   This file never changes a balance directly.
// - MySQL error 1644 = our SIGNAL '45000' messages from procedures
//   (like 'Insufficient balance'). We turn them into clean HTTP errors.
// - DECIMAL money columns come back as STRINGS (fine - use strings end to end).

import mysql from 'mysql2/promise';
import 'dotenv/config';

// The connection "pool": a small set of reusable DB connections.
export const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectionLimit: 10,
  dateStrings: true, // dates stay as 'YYYY-MM-DD' text, no timezone shifting
});

// A simple error class that carries an HTTP status code with it.
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// This message EXECUTED BY THE DB means someone tried to approve
// a loan without being a manager -> we return 403 (forbidden) not 400.
const FORBIDDEN = new Set(['Only a manager can approve loans']);

// Translate raw MySQL errors into clean HttpErrors the frontend can show.
function translate(err) {
  if (err.errno === 1644) {
    // 1644 = our own SIGNAL messages from procedures (already user-friendly)
    return new HttpError(FORBIDDEN.has(err.sqlMessage) ? 403 : 400, err.sqlMessage);
  }
  if (err.errno === 1062) {
    // 1062 = duplicate key (same CNIC / phone / email / username already used)
    return new HttpError(409, 'Already exists (CNIC, phone, email or username)');
  }
  console.error(err); // log anything unexpected so we can debug it
  return new HttpError(500, 'Database error');
}

// Run a stored procedure, e.g. callProc('sp_deposit', [1, '500.00', 3])
export async function callProc(name, args = []) {
  const marks = args.map(() => '?').join(','); // "?,?,?" - one ? per argument
  try {
    const [res] = await pool.query(`CALL ${name}(${marks})`, args);
    // Procedures that SELECT at the end return [rows, okPacket].
    // Procedures that only change data return just an okPacket -> no rows.
    return Array.isArray(res) && Array.isArray(res[0]) ? res[0] : [];
  } catch (e) {
    throw translate(e);
  }
}

// Run a SELECT statement, e.g. query('SELECT * FROM v_pending_loans')
export async function query(sql, args = []) {
  try {
    const [rows] = await pool.query(sql, args);
    return rows;
  } catch (e) {
    throw translate(e);
  }
}
