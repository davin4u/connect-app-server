const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const config = require('./config');

function hashPassword(password) {
  return bcrypt.hashSync(password, config.BCRYPT_ROUNDS);
}

function comparePassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

function signToken(userId) {
  return jwt.sign({ userId }, config.JWT_SECRET, { expiresIn: '30d' });
}

function verifyToken(token) {
  return jwt.verify(token, config.JWT_SECRET);
}

// Express middleware for authenticated routes
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }

  const token = header.slice(7);
  try {
    const payload = verifyToken(token);
    req.userId = payload.userId;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { hashPassword, comparePassword, signToken, verifyToken, requireAuth };
