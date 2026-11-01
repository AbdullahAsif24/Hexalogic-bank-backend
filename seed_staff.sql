-- ============================================================
-- seed_staff.sql - create a MANAGER and a TELLER login
-- Run this in MySQL Workbench as ROOT (bank_app cannot insert).
-- ============================================================
-- The backend's register endpoint only creates CUSTOMERS by design.
-- Staff logins must be inserted directly, as the guide says:
--   "tellers and managers need seeded user_account rows with bcrypt hashes."

-- passwords (bcrypt, cost 10) - CHANGE THESE AFTER FIRST LOGIN:
--   manager123 -> $2b$10$W/AnYc1bYpT3Rdj0/mk2CeMHJaNgpwRprAqZCdIoIrwhwnSgugHC.
--   teller123  -> $2b$10$MdCPqHbeFkl7DpEkGen6quhuXkTpql6uCiy9lZGf3dVCsi0mEv/4i

USE BankDB;

-- 1) unique SVNICs and emails are required by the tables; adjust if your seed data already used them
-- 2) branch_id: run  SELECT branch_id, branch_code FROM branch;  first and pick a real branch
--    (the seed data creates 3 branches, so branch_id between 1 and 3)

-- ---------- the MANAGER ----------
INSERT INTO employee (branch_id, cnic, name, designation, email)
VALUES (1, '3511111111101', 'Ahmed Manager', 'Manager', 'manager@bank.com');

INSERT INTO user_account (username, password_hash, role, customer_id, employee_id)
VALUES ('manager', '$2b$10$W/AnYc1bYpT3Rdj0/mk2CeMHJaNgpwRprAqZCdIoIrwhwnSgugHC.',
        'manager', NULL, LAST_INSERT_ID());

-- ---------- the TELLER ----------
INSERT INTO employee (branch_id, cnic, name, designation, email)
VALUES (1, '3511111111102', 'Sara Teller', 'Teller', 'teller@bank.com');

INSERT INTO user_account (username, password_hash, role, customer_id, employee_id)
VALUES ('teller', '$2b$10$MdCPqHbeFkl7DpEkGen6quhuXkTpql6uCiy9lZGf3dVCsi0mEv/4i',
        'teller', NULL, LAST_INSERT_ID());

-- ---------- verify ----------
SELECT user_id, username, role, employee_id FROM user_account;
SELECT employee_id, branch_id, name, designation, email FROM employee;

-- ============================================================
-- Their logins:
--   manager / manager123   -> can set account status, approve loans, see reports
--   teller  / teller123    -> can open accounts, deposit/withdraw, issue cards
-- (passwords are case sensitive!)
-- ============================================================
