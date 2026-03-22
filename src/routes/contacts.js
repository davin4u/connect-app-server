const express = require('express');
const db = require('../db');
const { requireSignatureAuth } = require('../signatureAuth');
const { generateContactCode } = require('../utils/contactCode');

const router = express.Router();

// All routes here require signature authentication
router.use(requireSignatureAuth);

// GET /api/contacts
router.get('/', async (req, res) => {
  const userId = req.userId;

  // Get accepted contacts in both directions
  const contacts = await db.all(`
    SELECT u.id, u.contact_code, u.display_name, u.public_key, u.chat_public_key
    FROM contacts c
    JOIN users u ON u.id = CASE
      WHEN c.user_id = ? THEN c.contact_id
      ELSE c.user_id
    END
    WHERE (c.user_id = ? OR c.contact_id = ?)
      AND c.status = 'accepted'
    GROUP BY u.id
  `, [userId, userId, userId]);

  res.json({
    contacts: contacts.map(c => ({
      id: c.id,
      contactCode: c.contact_code,
      displayName: c.display_name,
      publicKey: c.public_key,
      chatPublicKey: c.chat_public_key,
    })),
  });
});

// GET /api/contacts/requests
router.get('/requests', async (req, res) => {
  const userId = req.userId;

  // Incoming: others sent to me
  const incoming = await db.all(`
    SELECT u.id, u.contact_code, u.display_name, c.created_at
    FROM contacts c
    JOIN users u ON u.id = c.user_id
    WHERE c.contact_id = ? AND c.status = 'pending'
    ORDER BY c.created_at DESC
  `, [userId]);

  // Outgoing: I sent to others
  const outgoing = await db.all(`
    SELECT u.id, u.contact_code, u.display_name, c.created_at
    FROM contacts c
    JOIN users u ON u.id = c.contact_id
    WHERE c.user_id = ? AND c.status = 'pending'
    ORDER BY c.created_at DESC
  `, [userId]);

  const mapRow = r => ({
    id: r.id,
    contactCode: r.contact_code,
    displayName: r.display_name,
    createdAt: r.created_at,
  });

  res.json({
    incoming: incoming.map(mapRow),
    outgoing: outgoing.map(mapRow),
    // Backward compat: flat list of incoming for older clients
    requests: incoming.map(mapRow),
  });
});

// POST /api/contacts/add
router.post('/add', async (req, res) => {
  const userId = req.userId;
  const { contactCode } = req.body;

  if (!contactCode || typeof contactCode !== 'string') {
    return res.status(400).json({ error: 'Contact code is required' });
  }

  // Find target user by contact code
  const target = await db.get('SELECT id FROM users WHERE contact_code = ?', [contactCode]);
  if (!target) {
    return res.status(404).json({ error: 'Contact code not found' });
  }

  // Cannot add self
  if (target.id === userId) {
    return res.status(400).json({ error: 'Cannot add yourself as a contact' });
  }

  // Check for existing relationship in either direction
  const existing = await db.get(
    'SELECT status FROM contacts WHERE (user_id = ? AND contact_id = ?) OR (user_id = ? AND contact_id = ?)',
    [userId, target.id, target.id, userId]
  );

  if (existing) {
    return res.status(409).json({ error: 'Contact relationship already exists' });
  }

  // Insert pending request (sender -> receiver)
  await db.run(
    'INSERT INTO contacts (user_id, contact_id, status) VALUES (?, ?, ?)',
    [userId, target.id, 'pending']
  );

  // Notify target via Socket.IO if online
  const { getOnlineUsers, getIO } = require('../socket/presence');
  const onlineUsers = getOnlineUsers();
  if (onlineUsers.has(target.id)) {
    const sender = await db.get('SELECT id, contact_code, display_name FROM users WHERE id = ?', [userId]);
    const io = getIO();
    for (const socketId of onlineUsers.get(target.id)) {
      io.to(socketId).emit('contact:request', {
        id: sender.id,
        contactCode: sender.contact_code,
        displayName: sender.display_name,
      });
    }
  }

  res.json({ status: 'sent' });
});

// POST /api/contacts/accept
router.post('/accept', async (req, res) => {
  const userId = req.userId;
  const { userId: requesterId } = req.body;

  if (!requesterId || typeof requesterId !== 'string') {
    return res.status(400).json({ error: 'Requester userId is required' });
  }

  // Find the pending request
  const pending = await db.get(
    'SELECT 1 FROM contacts WHERE user_id = ? AND contact_id = ? AND status = ?',
    [requesterId, userId, 'pending']
  );

  if (!pending) {
    return res.status(404).json({ error: 'No pending request from this user' });
  }

  // Update to accepted and insert reverse row
  await db.transaction(async (client) => {
    await client.run(
      'UPDATE contacts SET status = ? WHERE user_id = ? AND contact_id = ?',
      ['accepted', requesterId, userId]
    );
    await client.run(
      'INSERT INTO contacts (user_id, contact_id, status) VALUES (?, ?, ?)',
      [userId, requesterId, 'accepted']
    );
  });

  // Notify requester if online — include chatPublicKey
  const { getOnlineUsers, getIO } = require('../socket/presence');
  const onlineUsers = getOnlineUsers();
  if (onlineUsers.has(requesterId)) {
    const currentUser = await db.get(
      'SELECT id, contact_code, display_name, public_key, chat_public_key FROM users WHERE id = ?',
      [userId]
    );
    const io = getIO();
    for (const socketId of onlineUsers.get(requesterId)) {
      io.to(socketId).emit('contact:accepted', {
        id: currentUser.id,
        contactCode: currentUser.contact_code,
        displayName: currentUser.display_name,
        publicKey: currentUser.public_key,
        chatPublicKey: currentUser.chat_public_key,
      });
    }
  }

  res.json({ status: 'accepted' });
});

// POST /api/contacts/reject
router.post('/reject', async (req, res) => {
  const userId = req.userId;
  const { userId: requesterId } = req.body;

  if (!requesterId || typeof requesterId !== 'string') {
    return res.status(400).json({ error: 'Requester userId is required' });
  }

  await db.run(
    'DELETE FROM contacts WHERE user_id = ? AND contact_id = ? AND status = ?',
    [requesterId, userId, 'pending']
  );

  res.json({ status: 'rejected' });
});

// POST /api/contacts/regenerate-code
router.post('/regenerate-code', async (req, res) => {
  const userId = req.userId;

  // Get current code
  const user = await db.get('SELECT contact_code FROM users WHERE id = ?', [userId]);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const oldCode = user.contact_code;
  const newCode = generateContactCode();

  await db.transaction(async (client) => {
    // Retire old code
    const insertIgnoreSQL = db.insertIgnore(
      'retired_codes',
      `code, retired_at`,
      `?, ${db.nowEpoch()}`
    );
    await client.run(insertIgnoreSQL, [oldCode]);

    // Update user with new code
    await client.run('UPDATE users SET contact_code = ? WHERE id = ?', [newCode, userId]);
  });

  res.json({ contactCode: newCode });
});

module.exports = router;
