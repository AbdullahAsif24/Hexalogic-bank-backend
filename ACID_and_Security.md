# ACID Properties & Security — Banking System (DBMS Project)

Node.js + Express backend, React frontend, MySQL 8 (InnoDB) on Aiven.
This document maps **every** ACID property and security mechanism to the
exact place it lives in the code, so it can be explained (and demonstrated)
in the viva. Honest gaps are listed at the end.

---

## Part 1 — ACID properties

ACID is provided by the **database layer** — by InnoDB plus our stored
procedures — NOT by the Node code. The backend never writes
`UPDATE account SET balance = ...` directly; every money change is
`CALL sp_...`, so transaction control, row locks and audit trail always run.

### A — Atomicity ("all of it happens, or none of it does")

| Operation | Mechanics |
| --------- | --------- |
| Transfer                      | `sp_transfer_funds`: debit + credit + 2 transaction rows (`transfer_out`, `transfer_in`) inside one `START TRANSACTION ... COMMIT`. `DECLARE EXIT HANDLER FOR SQLEXCEPTION` does `ROLLBACK; RESIGNAL`. A failure mid-way (e.g. insufficient balance discovered after locking) undoes everything. |
| Loan installment               | `sp_pay_installment`: account debit **and** `loan_payment` insert **and** a `withdraw` transaction row — never one without the others. |
| Account opening                | `sp_open_account`: `INSERT account` + `INSERT customer_account` (primary holder) + initial-deposit transaction row in one transaction. |
| Customer registration          | `sp_register_customer`: customer row **and** login row (`user_account`) together. |

Extra atomicity guarantees come straight from InnoDB internals:

- **Undo logs** — an incomplete/crashed transaction is invisible; its changes are rolled back.
- **Redo logs + doublewrite buffer** — a power failure mid-write cannot leave half a transaction committed.
- The two SQL files involved: `04_procedures.sql` (handlers), InnoDB engine choice in `01_schema.sql` (`ENGINE=InnoDB`).

### C — Consistency ("rules of the bank are never bent, not even by a bug")

Three layers enforce the design PDF's rules:

1. **Declarative constraints** (`01_schema.sql` + `02_indexes.sql`)

   | Constraint | Rule enforced |
   | ---------- | ------------- |
   | `CHECK (amount > 0)`, `CHECK (balance >= 0)`, `CHECK (principal_amount > 0)` | money can never be zero/negative |
   | `CHECK ((customer_id IS NULL) <> (employee_id IS NULL))` in `user_account` | a login is either staff or customer - never both, never neither |
   | `UNIQUE` on cnic / phone / email / username / account_number / card_number | no duplicate identities or numbers |
   | FKs everywhere (`branch_id`, `account_type_id`, `customer_id`, ...) | no orphan rows, no transfers to a deleted account |
   | `ENUM` for status/role/txn_type | no invented states like 'Pending ' or 'active ' |
   | `DECIMAL(15,2)` for money (never FLOAT) | no rounding drift in stored values |

2. **Business rules inside procedures** (raise `SIGNAL SQLSTATE '45000'`):
   withdraw keeps `balance - amount >= min_balance`; close requires
   `balance = 0`; loan decisions require a **Manager** designation and a
   `pending` loan; installment payments cannot exceed the remaining
   principal; transfers require two **active** and different accounts.

3. **Triggers** (`05_triggers.sql`) — the rules an API caller cannot bypass,
   even if a junior dev writes raw SQL someday:

   | Trigger | What it guarantees |
   | ------- | ------------------ |
   | `trg_txn_block_inactive` | no transaction row can exist for a frozen/closed account |
   | `trg_txn_no_update` / `trg_txn_no_delete` | the transaction ledger is immutable (only `completed -> reversed` allowed) |
   | `trg_account_no_delete` | accounts can only be closed, never deleted |
   | `trg_loan_payment_close` | a loan automatically becomes `closed` when its balance reaches 0 |
   | `trg_card_expiry` | cards can never be issued already-expired |
   | `trg_branch_manager_check` | a branch manager must actually work at that branch |
   | `trg_account_balance_audit` | every balance/status change lands in `audit_log` |

Because of (2) and (3), "consistency" holds for the website users **and**
for anyone with raw database access — that's the point worth making in the viva.

### I — Isolation ("concurrent users never see each other half-way")

- InnoDB default isolation: **REPEATABLE READ** with MVCC (readers never block writers).
- **Pessimistic row locks**: every money procedure reads the account with
  `SELECT ... FOR UPDATE` BEFORE deciding anything — two simultaneous
  withdrawals serialise on the same locked row; the second one sees the
  updated balance and fails cleanly with `Insufficient balance`.
- **Deadlock prevention**: `sp_transfer_funds` locks the two accounts in
  **ascending `account_id` order** (`LEAST`/`GREATEST`). Two opposite
  transfers (A→B and B→A) acquire locks in the same order, so a classic
  AB/BA deadlock cannot happen.
- All transaction work happens entirely server-side; the app never holds
  long locks between HTTP requests.
- **Proof**: `tests/concurrency.test.js` fires 50 opposite transfers at once;
  expected result: no deadlocks, no negative balance, unchanged
  `SUM(balance)`. The same can be shown live from two Workbench tabs.

### D — Durability ("committed money survives a crash")

- InnoDB commits flush to the **redo log** (`innodb_flush_log_at_trx_commit = 1`, the default) — "committed" means durable, not "in RAM".
- **Doublewrite buffer** protects against torn pages on power loss.
- Hosting layer (Aiven): automated daily **backups**, automatic patching,
  service restart; Vercel keeps the stateless backend disposable - data
  lives only in MySQL.
- Application-side durability choice: money is **DECIMAL + strings end to
  end** (`"1500.50"`), never JavaScript floats, so no precision corruption
  between JSON → PHP... rather JSON → Node → MySQL.

---

## Part 2 — Where security lives

### 2.1 Database layer (defense in depth, deepest layer)

| Mechanism | Where / detail |
| --------- | -------------- |
| **Least-privilege app user** | The backend connects as `bank_app`, which has only `EXECUTE` on procedures + `SELECT` on a whitelist of views/3 tables. Even a fully compromised backend **cannot** `UPDATE balance` or `DROP` anything. Procedures run with their definer's rights, so they can still write the tables. |
| **Aiven managed MySQL** | Traffic is SSL-enforced (`ssl-mode=REQUIRED`, `DB_SSL=true` in `.env`); no public phpMyAdmin; database credentials are separate from every other credential. |
| **Audit trail** | `audit_log` is written only by triggers — even an insider cannot quietly change a balance without a record. |
| **Immutable ledger** | `trg_txn_no_update`/`trg_txn_no_delete` block auditing-destroying edits. |
| **Whitelist columns in views** | `v_customer_accounts` etc. expose only what reporting needs - the app never sees internal columns attackers could probe for. |

### 2.2 Backend layer (Node/Express)

**Authentication (`src/auth.js`)**

- Passwords hashed with **bcrypt, cost 10**; login compares the hash — plain text never stored or compared.
- Same error text `"Invalid username or password"` for unknown user and wrong password → no **user enumeration**.
- On success the server issues a **JWT (HS256, 8 h expiry)** containing `sub`, `role`, `customerId`, `employeeId` — the client never decides anything about identity.

**Authorization**

| Guard | File | Rule |
| ----- | ---- | ---- |
| `authenticate` | auth.js | every protected route demands a valid, unexpired token |
| `requireRole(...roles)` | auth.js | manager-only: account status, loan decisions, reports; teller+manager: counter ops, account opening, cards; **admin-only: the `/admin/*` custody endpoints** |
| `assertOwnsAccount(user, id)` | auth.js | a customer may only touch accounts in the `customer_account` junction with their own `customer_id` from the **token** |
| loan ownership check | routes/loans.js | installment payments only against the customer's own loans, paid **from** their own account |
| **identity NEVER from request body** | all routes | `employee_id`/`customer_id` used by procedures come from the verified JWT (`req.user.employeeId ?? null`), attackers cannot impersonate staff by editing JSON |

**Platform custody separation (the 4th role: `admin`)**

- `user_account.role` is `ENUM('customer','teller','manager','admin')`; admin owns
  staff logins (`sp_create_staff`), enabling/disabling (`sp_set_user_active`,
  self-disable blocked by the procedure) and password resets
  (`sp_reset_user_password`) - all re-checked inside the procedure by
  `designation = 'Administrator'`, so raw SQL access can't skip the rule either.
- Segregation of duties: the manager is the money authority (loans, freeze/close,
  reports); the admin is platform custody (staff logins, audit trail).
  Neither can act as the other at the API.
- `user_account.is_active = 0` soft-disables a login; login denies it with the
  same generic 401 as a wrong password (no account-status probing).
- Every password hash is generated in the backend with bcrypt - no system
  path accepts plain passwords for storage.

**Input validation (`src/validate.js`, zod, at the top of every route)**

- Money: regex `^\d{1,13}(\.\d{1,2})?$` (> 0), converted from number to string — floats never touch the API.
- CNIC: exactly 13 digits. Dates: `YYYY-MM-DD`. IDs: positive integers.
- Anything malformed → `400` with the first human-readable message, before any SQL runs.

**SQL-injection defense**

- All values bound with `?` placeholders (mysql2 prepares them); **no string concatenation of user input anywhere**.
- The only literals in queries are procedure/view names, which come from our code, not the request.
- `/loans/emi` demonstrates a **SQL function** call via placeholders too.

**Error handling / information discipline (`db.js` + `index.js`)**

- Database `SIGNAL 45000` messages reach the user verbatim (they were written to be user-safe); error 1644 → 400/403, 1062 → 409.
- Anything unexpected → logged server-side, client sees only generic `Database error` / `Server error`; **no stack traces, no table names, no SQL leaks out**.
- Central error handler = one place to keep that invariant.

**Hardening & configuration**

| Thing | Where |
| ----- | ----- |
| Secrets (`JWT_SECRET`, DB password) only in `.env` / platform env vars — `.env` is git-ignored, `.env.example` documents shape | repo config |
| `CORS_ORIGIN` allowlist — only the known frontend origins may call the API from a browser; everything else gets a 403 | `src/index.js` |
| HTTPS | enforced by Vercel + `ssl-mode=REQUIRED` to MySQL (Node → Aiven leg is TLS-encrypted) |
| Transport of money data as decimal strings | every route (`validate.js`) |
| All mutations via procedures | design decision (defense in depth, section 2.1) |

### 2.3 Frontend layer (React/Vite)

| Mechanism | Where | Why it matters |
| --------- | ----- | -------------- |
| Token handling | `src/api/client.js` | axios **interceptor** auto-attaches `Authorization: Bearer <token>`; a 401 response clears storage and bounces to `/login` — a logged-out user never sees privileged screens |
| Route guards | `src/components/Protected.jsx` | role-based rendering so e.g. a customer can't navigate to manager URLs; cosmetic layer — the **server re-checks on every request** (403), the real security |
| XSS resistance | React (JSX) | React escapes all displayed values by default; error messages and report rows are rendered as text, never via `dangerouslySetInnerHTML` |
| No secrets in the browser | `.env` front | only `VITE_API_URL` (public URL) and the demo flag — **`VITE_*` variables are readable by anyone**, so keys/DB secrets never go there |
| Client validation | form pages | friendly early errors (`isMoney`, CNIC length), but the server is the source of truth — API tests can bypass the UI and are still stopped |
| Demo mode | `VITE_DEMO` | demo adapter lets the app be shown without a live backend - no half-security configuration needed |
| HTTPS | Vercel deployment | certificates, TLS forced for all browser traffic |

### 2.4 Defense-in-depth summary

```
Browser        React form checks → JWT in header → HTTPS only
    │
    ▼
API (Node)     zod validate → authenticate → requireRole → ownership check
               → parameterised CALL → central error translation
    │
    ▼
MySQL (Aiven)  stored procedure: validate business rule →
               START TRANSACTION → FOR UPDATE row locks → COMMIT
    │
    ▼
Constraints+Triggers   CHECK/UNIQUE/FK/ENUM + audit + immutability
                       (guard even raw-SQL users)
```

An attacker must defeat **five independent layers**; the important design
point: even with a compromised application, the money rules still hold
inside the database.

---

## Part 3 — Honest gaps (what we would add with one more sprint)

1. **Rate limiting / brute-force protection** on `/auth/login` (express-rate-limit) and API generally.
2. **`helmet`** for free HTTP security headers (HSTS, CSP, etc.).
3. Staff password resets exist via the admin role (`POST /admin/users/:id/password` + UI), but per-user self-service "change password" and 2FA would still be the next step.
4. **JWT refresh strategy**: 8 h stateless tokens are long; refresh-token or 30-min login + re-auth for money op would tighten it.
5. **Expiry of `audit_log` growth**: it's append-only — needs retention policy / partitioning long-term.
6. **Account lockout / 2FA** for staff accounts.
7. **Seed passwords must be rotated** before public deployment (documented in README).
8. Optional nice-to-haves: request-level structured logs w/o PII, mutation endpoints idempotency keys, CSRF not needed (JWT in header, no cookies) but worth mentioning if cookies ever replace localStorage.

---

## Part 4 — Viva-ready demonstration script

1. **Atomicity**: run a valid transfer, then one with amount = balance + 1 →
   second fails; check account balances unchanged and NO extra
   `transaction` rows: `SELECT * FROM transaction ORDER BY transaction_id DESC LIMIT 4;`
2. **Isolation / deadlock-proof transfer**: `npm run test:concurrency`
   (50 opposite transfers) → no deadlocks, no negatives, `SUM(balance)` unchanged.
3. **Consistency invariants**: try `UPDATE account SET balance = -50;` →
   CHECK violation even as root; try transferring from a frozen account →
   `Account is not active`.
4. **Durability**: kill the backend mid-test, restart, balances are still correct (committed rows persisted in Aiven).
5. **Security**: run Postman without a token (`401`), with a customer token
   on `/reports/*` (`403`), with a doctored JSON body claiming to be a manager
   (identity still ignored -> comes from the JWT), try `q'--` in a search →
   results/syntax error safely returned, not executed.
6. **Immutability**: `DELETE FROM transaction WHERE transaction_id = 1;` →
   trigger error; `SELECT COUNT(*) FROM audit_log;` before/after any
   deposit → grew by 1.
