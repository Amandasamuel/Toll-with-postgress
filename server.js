const express = require('express');
const cors = require('cors');
const db = require('./db');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Global error logging
process.on('uncaughtException', err => console.error('Uncaught exception:', err));
process.on('unhandledRejection', err => console.error('Unhandled rejection:', err));

// Helper
function parseAmount(amount) {
  const num = Number(amount);
  return num > 0 ? num : null;
}

// 1️⃣ Register user + card
app.post('/register', async (req, res) => {
  const { name, phone, card_uid } = req.body;
  if (!name || !phone || !card_uid) return res.status(400).json({ error: "Missing fields" });

  try {
    const userResult = await db.query(
      'INSERT INTO users (name, phone) VALUES ($1, $2) RETURNING id', 
      [name, phone]
    );
    const userId = userResult.rows[0].id;

    await db.query('INSERT INTO wallets (user_id, balance) VALUES ($1, 0)', [userId]);
    await db.query('INSERT INTO cards (uid, user_id) VALUES ($1, $2)', [card_uid, userId]);

    res.json({ status: "registered", user_id: userId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2️⃣ Top-up wallet
app.post('/topup', async (req, res) => {
  const { card_uid, amount } = req.body;
  const amt = parseAmount(amount);
  if (!amt) return res.status(400).json({ error: "Invalid amount" });

  try {
    const { rows } = await db.query(`
      SELECT u.id, w.balance
      FROM users u
      JOIN cards c ON u.id = c.user_id
      JOIN wallets w ON u.id = w.user_id
      WHERE c.uid = $1
    `, [card_uid]);

    if (!rows[0]) return res.status(404).json({ error: "Card not found" });

    const newBalance = rows[0].balance + amt;
    await db.query('UPDATE wallets SET balance = $1 WHERE user_id = $2', [newBalance, rows[0].id]);
    await db.query('INSERT INTO transactions (user_id, amount, type) VALUES ($1, $2, $3)', [rows[0].id, amt, 'credit']);

    res.json({ status: "success", new_balance: newBalance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3️⃣ Debit wallet
app.post('/debit', async (req, res) => {
  const { card_uid, amount } = req.body;
  const amt = parseAmount(amount);
  if (!amt) return res.status(400).json({ error: "Invalid amount" });

  try {
    const { rows } = await db.query(`
      SELECT u.id, w.balance
      FROM users u
      JOIN cards c ON u.id = c.user_id
      JOIN wallets w ON u.id = w.user_id
      WHERE c.uid = $1
    `, [card_uid]);

    if (!rows[0]) return res.status(404).json({ error: "Card not found" });
    if (rows[0].balance < amt) return res.json({ status: "failed", reason: "Insufficient balance" });

    const newBalance = rows[0].balance - amt;
    await db.query('UPDATE wallets SET balance = $1 WHERE user_id = $2', [newBalance, rows[0].id]);
    await db.query('INSERT INTO transactions (user_id, amount, type) VALUES ($1, $2, $3)', [rows[0].id, amt, 'debit']);

    res.json({ status: "success", new_balance: newBalance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4️⃣ Check balance
app.get('/balance/:card_uid', async (req, res) => {
  const { card_uid } = req.params;
  try {
    const { rows } = await db.query(`
      SELECT w.balance
      FROM cards c
      JOIN wallets w ON c.user_id = w.user_id
      WHERE c.uid = $1
    `, [card_uid]);

    if (!rows[0]) return res.status(404).json({ error: "Card not found" });
    res.json({ balance: rows[0].balance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5️⃣ Transaction history
app.get('/transactions/:card_uid', async (req, res) => {
  const { card_uid } = req.params;
  try {
    const { rows } = await db.query(`
      SELECT t.id, t.amount, t.type, t.timestamp
      FROM transactions t
      JOIN cards c ON t.user_id = c.user_id
      WHERE c.uid = $1
      ORDER BY t.timestamp DESC
    `, [card_uid]);

    res.json({ transactions: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6️⃣ Transfer
app.post('/transfer', async (req, res) => {
  const { from_card, to_card, amount } = req.body;
  const amt = parseAmount(amount);
  if (!from_card || !to_card || !amt) return res.status(400).json({ error: "Missing or invalid fields" });

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const senderRes = await client.query(`
      SELECT u.id, w.balance
      FROM users u
      JOIN cards c ON u.id = c.user_id
      JOIN wallets w ON u.id = w.user_id
      WHERE c.uid = $1
    `, [from_card]);

    const receiverRes = await client.query(`
      SELECT u.id, w.balance
      FROM users u
      JOIN cards c ON u.id = c.user_id
      JOIN wallets w ON u.id = w.user_id
      WHERE c.uid = $1
    `, [to_card]);

    if (!senderRes.rows[0] || !receiverRes.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: "Sender or receiver not found" });
    }

    if (senderRes.rows[0].balance < amt) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: "Insufficient funds" });
    }

    await client.query('UPDATE wallets SET balance = balance - $1 WHERE user_id = $2', [amt, senderRes.rows[0].id]);
    await client.query('UPDATE wallets SET balance = balance + $1 WHERE user_id = $2', [amt, receiverRes.rows[0].id]);
    await client.query('INSERT INTO transactions (user_id, amount, type) VALUES ($1, $2, $3)', [senderRes.rows[0].id, amt, 'debit']);
    await client.query('INSERT INTO transactions (user_id, amount, type) VALUES ($1, $2, $3)', [receiverRes.rows[0].id, amt, 'credit']);

    await client.query('COMMIT');
    res.json({ status: "success", message: `Transferred ₦${amt} from ${from_card} to ${to_card}` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Start server
app.listen(3000, '0.0.0.0', () => console.log("🚀 Server running on http://192.168.0.140:3000"));
