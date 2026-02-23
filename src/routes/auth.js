const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { generateContactCode } = require('../utils/contactCode');
const { generateChallenge, verifyPow } = require('../utils/pow');
const { generateDisplayName } = require('../utils/nameGenerator');

const router = express.Router();

// POST /api/pow/challenge — get a PoW challenge for registration
router.post('/pow/challenge', (req, res) => {
  const { action } = req.body;
  if (!action || typeof action !== 'string') {
    return res.status(400).json({ error: 'Action is required' });
  }

  const challenge = generateChallenge(action);
  res.json(challenge);
});

// POST /api/register — create account with PoW proof
router.post('/register', (req, res) => {
  const { challenge, nonce, publicKey, chatPublicKey, displayName } = req.body;

  // Validate required fields
  if (!challenge || typeof challenge !== 'string') {
    return res.status(400).json({ error: 'Challenge is required' });
  }
  if (nonce === undefined || nonce === null) {
    return res.status(400).json({ error: 'Nonce is required' });
  }
  if (!publicKey || typeof publicKey !== 'string') {
    return res.status(400).json({ error: 'Public key is required' });
  }
  if (!chatPublicKey || typeof chatPublicKey !== 'string') {
    return res.status(400).json({ error: 'Chat public key is required' });
  }
  if (!displayName || typeof displayName !== 'string' || displayName.trim().length < 1 || displayName.trim().length > 50) {
    return res.status(400).json({ error: 'Display name must be 1-50 characters' });
  }

  // Verify PoW
  if (!verifyPow(challenge, nonce)) {
    return res.status(400).json({ error: 'Invalid proof of work' });
  }

  // Check publicKey uniqueness
  const existingKey = db.prepare('SELECT 1 FROM users WHERE public_key = ?').get(publicKey);
  if (existingKey) {
    return res.status(409).json({ error: 'Public key already registered' });
  }

  // Check display name uniqueness
  const existingName = db.prepare('SELECT 1 FROM users WHERE display_name = ?').get(displayName.trim());
  if (existingName) {
    return res.status(409).json({ error: 'Display name already taken' });
  }

  const id = uuidv4();
  const contactCode = generateContactCode();

  db.prepare(
    'INSERT INTO users (id, contact_code, display_name, public_key, chat_public_key) VALUES (?, ?, ?, ?, ?)'
  ).run(id, contactCode, displayName.trim(), publicKey, chatPublicKey);

  res.status(201).json({
    id,
    contactCode,
    displayName: displayName.trim(),
  });
});

// POST /api/recover — look up account by public key
router.post('/recover', (req, res) => {
  const { publicKey } = req.body;

  if (!publicKey || typeof publicKey !== 'string') {
    return res.status(400).json({ error: 'Public key is required' });
  }

  const user = db.prepare(
    'SELECT id, contact_code, display_name, public_key, chat_public_key FROM users WHERE public_key = ?'
  ).get(publicKey);

  if (!user) {
    return res.status(404).json({ error: 'Identity not found' });
  }

  // Get contacts
  const contacts = db.prepare(`
    SELECT u.id, u.contact_code, u.display_name, u.public_key, u.chat_public_key
    FROM contacts c
    JOIN users u ON u.id = CASE
      WHEN c.user_id = ? THEN c.contact_id
      ELSE c.user_id
    END
    WHERE (c.user_id = ? OR c.contact_id = ?)
      AND c.status = 'accepted'
    GROUP BY u.id
  `).all(user.id, user.id, user.id);

  res.json({
    id: user.id,
    contactCode: user.contact_code,
    displayName: user.display_name,
    publicKey: user.public_key,
    chatPublicKey: user.chat_public_key,
    contacts: contacts.map(c => ({
      id: c.id,
      contactCode: c.contact_code,
      displayName: c.display_name,
      publicKey: c.public_key,
      chatPublicKey: c.chat_public_key,
    })),
  });
});

// POST /api/generate-name — generate a random unique display name
router.post('/generate-name', (_req, res) => {
  try {
    const name = generateDisplayName();
    res.json({ name });
  } catch (e) {
    res.status(500).json({ error: 'Failed to generate name' });
  }
});

module.exports = router;
