const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();

// All routes here require authentication
router.use(requireAuth);

// GET /api/contacts
router.get('/', (req, res) => {
  const userId = req.userId;

  // Get accepted contacts in both directions
  const contacts = db.prepare(`
    SELECT u.id, u.contact_code, u.display_name, u.public_key
    FROM contacts c
    JOIN users u ON u.id = CASE
      WHEN c.user_id = ? THEN c.contact_id
      ELSE c.user_id
    END
    WHERE (c.user_id = ? OR c.contact_id = ?)
      AND c.status = 'accepted'
    GROUP BY u.id
  `).all(userId, userId, userId);

  res.json({
    contacts: contacts.map(c => ({
      id: c.id,
      contactCode: c.contact_code,
      displayName: c.display_name,
      publicKey: c.public_key,
    })),
  });
});

// GET /api/contacts/requests
router.get('/requests', (req, res) => {
  const userId = req.userId;

  const requests = db.prepare(`
    SELECT u.id, u.contact_code, u.display_name
    FROM contacts c
    JOIN users u ON u.id = c.user_id
    WHERE c.contact_id = ? AND c.status = 'pending'
  `).all(userId);

  res.json({
    requests: requests.map(r => ({
      id: r.id,
      contactCode: r.contact_code,
      displayName: r.display_name,
    })),
  });
});

// POST /api/contacts/add
router.post('/add', (req, res) => {
  const userId = req.userId;
  const { contactCode } = req.body;

  if (!contactCode || typeof contactCode !== 'string') {
    return res.status(400).json({ error: 'Contact code is required' });
  }

  // Find target user by contact code
  const target = db.prepare('SELECT id FROM users WHERE contact_code = ?').get(contactCode);
  if (!target) {
    return res.status(404).json({ error: 'Contact code not found' });
  }

  // Cannot add self
  if (target.id === userId) {
    return res.status(400).json({ error: 'Cannot add yourself as a contact' });
  }

  // Check for existing relationship in either direction
  const existing = db.prepare(
    'SELECT status FROM contacts WHERE (user_id = ? AND contact_id = ?) OR (user_id = ? AND contact_id = ?)'
  ).get(userId, target.id, target.id, userId);

  if (existing) {
    return res.status(409).json({ error: 'Contact relationship already exists' });
  }

  // Insert pending request (sender -> receiver)
  db.prepare(
    'INSERT INTO contacts (user_id, contact_id, status) VALUES (?, ?, ?)'
  ).run(userId, target.id, 'pending');

  // Notify target via Socket.IO if online (handled by the caller via getIO)
  const { getOnlineUsers, getIO } = require('../socket/presence');
  const onlineUsers = getOnlineUsers();
  if (onlineUsers.has(target.id)) {
    const sender = db.prepare('SELECT id, contact_code, display_name FROM users WHERE id = ?').get(userId);
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
router.post('/accept', (req, res) => {
  const userId = req.userId;
  const { userId: requesterId } = req.body;

  if (!requesterId || typeof requesterId !== 'string') {
    return res.status(400).json({ error: 'Requester userId is required' });
  }

  // Find the pending request
  const pending = db.prepare(
    'SELECT 1 FROM contacts WHERE user_id = ? AND contact_id = ? AND status = ?'
  ).get(requesterId, userId, 'pending');

  if (!pending) {
    return res.status(404).json({ error: 'No pending request from this user' });
  }

  // Update to accepted and insert reverse row
  const acceptTransaction = db.transaction(() => {
    db.prepare(
      'UPDATE contacts SET status = ? WHERE user_id = ? AND contact_id = ?'
    ).run('accepted', requesterId, userId);

    db.prepare(
      'INSERT INTO contacts (user_id, contact_id, status) VALUES (?, ?, ?)'
    ).run(userId, requesterId, 'accepted');
  });
  acceptTransaction();

  // Notify requester if online
  const { getOnlineUsers, getIO } = require('../socket/presence');
  const onlineUsers = getOnlineUsers();
  if (onlineUsers.has(requesterId)) {
    const currentUser = db.prepare(
      'SELECT id, contact_code, display_name, public_key FROM users WHERE id = ?'
    ).get(userId);
    const io = getIO();
    for (const socketId of onlineUsers.get(requesterId)) {
      io.to(socketId).emit('contact:accepted', {
        id: currentUser.id,
        contactCode: currentUser.contact_code,
        displayName: currentUser.display_name,
        publicKey: currentUser.public_key,
      });
    }
  }

  res.json({ status: 'accepted' });
});

// POST /api/contacts/reject
router.post('/reject', (req, res) => {
  const userId = req.userId;
  const { userId: requesterId } = req.body;

  if (!requesterId || typeof requesterId !== 'string') {
    return res.status(400).json({ error: 'Requester userId is required' });
  }

  db.prepare(
    'DELETE FROM contacts WHERE user_id = ? AND contact_id = ? AND status = ?'
  ).run(requesterId, userId, 'pending');

  res.json({ status: 'rejected' });
});

module.exports = router;
