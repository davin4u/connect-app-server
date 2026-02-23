const crypto = require('crypto');
const config = require('../config');

// In-memory challenge store: Map<challenge, { difficulty, expiresAt, used }>
const challenges = new Map();

// Cleanup expired challenges every 60 seconds
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of challenges) {
    if (val.expiresAt < now) {
      challenges.delete(key);
    }
  }
}, 60000);

function generateChallenge(action) {
  const timestamp = Math.floor(Date.now() / 1000);
  const random = crypto.randomBytes(8).toString('hex');
  const challenge = `${action}:${timestamp}:${random}`;
  const difficulty = config.POW_DIFFICULTY;

  challenges.set(challenge, {
    difficulty,
    expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
    used: false,
  });

  return { challenge, difficulty };
}

function verifyPow(challenge, nonce) {
  const stored = challenges.get(challenge);
  if (!stored) {
    return false;
  }

  if (stored.used) {
    return false;
  }

  if (stored.expiresAt < Date.now()) {
    challenges.delete(challenge);
    return false;
  }

  // Mark as used (single-use)
  stored.used = true;

  // Verify: SHA-256(challenge + ':' + nonce) must have stored difficulty leading zero bits
  const input = challenge + ':' + nonce;
  const hash = crypto.createHash('sha256').update(input).digest();

  return hasLeadingZeroBits(hash, stored.difficulty);
}

function hasLeadingZeroBits(hash, difficulty) {
  let remaining = difficulty;
  for (let i = 0; i < hash.length && remaining > 0; i++) {
    if (remaining >= 8) {
      if (hash[i] !== 0) {
        return false;
      }
      remaining -= 8;
    } else {
      const mask = 0xff << (8 - remaining);
      if ((hash[i] & mask) !== 0) {
        return false;
      }
      remaining = 0;
    }
  }
  return true;
}

module.exports = { generateChallenge, verifyPow };
