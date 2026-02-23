const nacl = require('tweetnacl');
const { decodeBase64 } = require('tweetnacl-util');
const db = require('./db');

function requireSignatureAuth(req, res, next) {
  const publicKey = req.headers['x-public-key'];
  const signature = req.headers['x-signature'];
  const timestamp = req.headers['x-timestamp'];

  if (!publicKey || !signature || !timestamp) {
    return res.status(401).json({ error: 'Missing auth headers' });
  }

  // Replay protection: timestamp within 5 minutes
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp, 10)) > 300) {
    return res.status(401).json({ error: 'Request expired' });
  }

  // Build payload: body JSON + ':' + timestamp
  // For GET requests body is empty object, JSON.stringify({}) = '{}'
  const bodyStr = req.method === 'GET' ? '' : JSON.stringify(req.body);
  const payload = bodyStr + ':' + timestamp;

  let isValid;
  try {
    isValid = nacl.sign.detached.verify(
      new TextEncoder().encode(payload),
      decodeBase64(signature),
      decodeBase64(publicKey)
    );
  } catch {
    return res.status(401).json({ error: 'Invalid signature format' });
  }

  if (!isValid) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Look up user by public_key
  const user = db.prepare('SELECT id, public_key, chat_public_key, display_name, contact_code FROM users WHERE public_key = ?').get(publicKey);
  if (!user) {
    return res.status(401).json({ error: 'Unknown identity' });
  }

  req.user = user;
  req.userId = user.id;
  next();
}

module.exports = { requireSignatureAuth };
