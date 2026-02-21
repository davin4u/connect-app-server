const crypto = require('crypto');
const db = require('../db');

// Removed I, O, 0, 1 to avoid visual confusion
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateContactCode() {
  const existing = db.prepare('SELECT 1 FROM users WHERE contact_code = ?');

  for (let attempt = 0; attempt < 10; attempt++) {
    const bytes = crypto.randomBytes(8);
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += CHARS[bytes[i] % CHARS.length];
    }
    const formatted = code.slice(0, 4) + '-' + code.slice(4);

    if (!existing.get(formatted)) {
      return formatted;
    }
  }

  throw new Error('Failed to generate unique contact code');
}

module.exports = { generateContactCode };
