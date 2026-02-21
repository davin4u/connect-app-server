const { Server } = require('socket.io');
const { verifyToken } = require('../auth');
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

  // Authentication middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Authentication required'));
    }

    try {
      const payload = verifyToken(token);
      socket.userId = payload.userId;
      next();
    } catch {
      next(new Error('Invalid or expired token'));
    }
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

    // Handle disconnect
    socket.on('disconnect', () => {
      console.log(`User disconnected: ${userId} (socket: ${socket.id})`);
      removeSocket(userId, socket.id);
    });
  });

  return io;
}

module.exports = { initSocketIO };
