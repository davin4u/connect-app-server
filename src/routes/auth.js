const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { hashPassword, comparePassword, signToken } = require('../auth');
const { generateContactCode } = require('../utils/contactCode');

const router = express.Router();

// POST /api/register
router.post('/register', (req, res) => {
  const { username, password, displayName, publicKey } = req.body;

  // Validation
  if (!username || typeof username !== 'string' || !/^[a-zA-Z0-9]{3,20}$/.test(username)) {
    return res.status(400).json({ error: 'Username must be 3-20 alphanumeric characters' });
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  if (!displayName || typeof displayName !== 'string' || displayName.trim().length < 1 || displayName.trim().length > 30) {
    return res.status(400).json({ error: 'Display name must be 1-30 characters' });
  }
  if (!publicKey || typeof publicKey !== 'string' || publicKey.trim().length === 0) {
    return res.status(400).json({ error: 'Public key is required' });
  }

  // Check username uniqueness
  const existingUser = db.prepare('SELECT 1 FROM users WHERE username = ?').get(username);
  if (existingUser) {
    return res.status(409).json({ error: 'Username already taken' });
  }

  const id = uuidv4();
  const contactCode = generateContactCode();
  const passwordHash = hashPassword(password);

  db.prepare(
    'INSERT INTO users (id, contact_code, username, password_hash, display_name, public_key) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, contactCode, username, passwordHash, displayName.trim(), publicKey);

  res.status(201).json({
    id,
    contactCode,
    username,
    displayName: displayName.trim(),
  });
});

// POST /api/login
router.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const user = db.prepare(
    'SELECT id, contact_code, username, password_hash, display_name, public_key FROM users WHERE username = ?'
  ).get(username);

  if (!user || !comparePassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = signToken(user.id);

  res.json({
    token,
    user: {
      id: user.id,
      contactCode: user.contact_code,
      username: user.username,
      displayName: user.display_name,
      publicKey: user.public_key,
    },
  });
});

module.exports = router;
