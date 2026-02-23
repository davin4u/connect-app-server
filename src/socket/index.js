const { Server } = require('socket.io');
const nacl = require('tweetnacl');
const { decodeBase64 } = require('tweetnacl-util');
const db = require('../db');
const { setIO, addSocket, removeSocket, isUserOnline, getAcceptedContactIds } = require('./presence');
const { registerChatHandlers } = require('./chat');
const { registerSignalingHandlers } = require('./signaling');
const { registerContactHandlers } = require('./contacts');

function initSocketIO(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  setIO(io);

  // Signature-based authentication middleware
  io.use((socket, next) => {
    const { publicKey, timestamp, signature } = socket.handshake.auth;

    if (!publicKey || !timestamp || !signature) {
      return next(new Error('Authentication required'));
    }

    // Replay protection: timestamp within 5 minutes
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parseInt(timestamp, 10)) > 300) {
      return next(new Error('Authentication expired'));
    }

    // Verify Ed25519 signature of timestamp string
    let isValid;
    try {
      isValid = nacl.sign.detached.verify(
        new TextEncoder().encode(timestamp),
        decodeBase64(signature),
        decodeBase64(publicKey)
      );
    } catch {
      return next(new Error('Invalid signature format'));
    }

    if (!isValid) {
      return next(new Error('Invalid signature'));
    }

    // Look up user by public_key
    const user = db.prepare('SELECT id FROM users WHERE public_key = ?').get(publicKey);
    if (!user) {
      return next(new Error('Unknown identity'));
    }

    socket.userId = user.id;
    next();
  });

  io.on('connection', (socket) => {
    const userId = socket.userId;
    console.log(`User connected: ${userId} (socket: ${socket.id})`);

    // Track presence
    addSocket(userId, socket.id);

    // Register event handlers
    registerChatHandlers(socket);
    registerSignalingHandlers(socket);
    registerContactHandlers(socket);

    // Send current online status of contacts
    const contactIds = getAcceptedContactIds(userId);
    for (const contactId of contactIds) {
      if (isUserOnline(contactId)) {
        socket.emit('presence:update', { userId: contactId, online: true });
      }
    }

    // Deliver unread messages
    const undelivered = db.prepare(
      'SELECT id, sender_id, ciphertext, nonce, timestamp FROM messages WHERE receiver_id = ? AND delivered = 0 ORDER BY timestamp ASC'
    ).all(userId);

    for (const msg of undelivered) {
      socket.emit('message:receive', {
        id: msg.id,
        from: msg.sender_id,
        ciphertext: msg.ciphertext,
        nonce: msg.nonce,
        timestamp: msg.timestamp,
      });
    }

    // Deliver pending events (e.g. message deletions while offline)
    const pendingEvents = db.prepare(
      'SELECT * FROM pending_events WHERE user_id = ? ORDER BY timestamp ASC'
    ).all(userId);

    for (const event of pendingEvents) {
      const payload = JSON.parse(event.payload);
      socket.emit(event.event_type, payload);
    }

    if (pendingEvents.length > 0) {
      db.prepare('DELETE FROM pending_events WHERE user_id = ?').run(userId);
    }

    // Handle disconnect
    socket.on('disconnect', () => {
      console.log(`User disconnected: ${userId} (socket: ${socket.id})`);
      removeSocket(userId, socket.id);
    });
  });

  return io;
}

module.exports = { initSocketIO };
