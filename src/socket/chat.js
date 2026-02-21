const db = require('../db');
const { getOnlineUsers } = require('./presence');

function registerChatHandlers(socket) {
  const userId = socket.userId;

  // message:send
  socket.on('message:send', (data) => {
    console.log(`[chat] message:send from ${userId}`, JSON.stringify(data).slice(0, 200));
    const { id, to, ciphertext, nonce, timestamp } = data;

    if (!id || !to || !ciphertext || !nonce) {
      console.log(`[chat] REJECTED: missing fields. id=${id} to=${to} ciphertext=${!!ciphertext} nonce=${!!nonce}`);
      return socket.emit('error', { message: 'Missing required message fields' });
    }

    // Verify sender and recipient are accepted contacts
    const contact = db.prepare(
      'SELECT 1 FROM contacts WHERE user_id = ? AND contact_id = ? AND status = ?'
    ).get(userId, to, 'accepted');

    if (!contact) {
      console.log(`[chat] REJECTED: not contacts. sender=${userId} to=${to}`);
      return socket.emit('error', { message: 'Recipient is not in your contacts' });
    }

    // Store message in DB
    const ts = timestamp || Math.floor(Date.now() / 1000);
    db.prepare(
      'INSERT INTO messages (id, sender_id, receiver_id, ciphertext, nonce, timestamp) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, userId, to, ciphertext, nonce, ts);

    // Confirm to sender
    socket.emit('message:sent', { id, timestamp: ts });
    console.log(`[chat] message stored & confirmed. id=${id} to=${to}`);

    // Deliver to recipient if online
    const onlineUsers = getOnlineUsers();
    if (onlineUsers.has(to)) {
      for (const socketId of onlineUsers.get(to)) {
        socket.to(socketId).emit('message:receive', {
          id,
          from: userId,
          ciphertext,
          nonce,
          timestamp: ts,
        });
      }
      console.log(`[chat] delivered to online recipient ${to}`);
    } else {
      console.log(`[chat] recipient ${to} offline, stored for later`);
    }
  });

  // message:ack
  socket.on('message:ack', (data) => {
    const { messageId } = data;
    if (!messageId) return;

    // Mark as delivered
    const msg = db.prepare(
      'SELECT sender_id FROM messages WHERE id = ? AND receiver_id = ?'
    ).get(messageId, userId);

    if (!msg) return;

    db.prepare('UPDATE messages SET delivered = 1 WHERE id = ?').run(messageId);

    // Notify sender
    const onlineUsers = getOnlineUsers();
    if (onlineUsers.has(msg.sender_id)) {
      for (const socketId of onlineUsers.get(msg.sender_id)) {
        socket.to(socketId).emit('message:delivered', { messageId });
      }
    }
  });

  // typing
  socket.on('typing', (data) => {
    const { to, isTyping } = data;
    if (!to) return;

    const onlineUsers = getOnlineUsers();
    if (onlineUsers.has(to)) {
      for (const socketId of onlineUsers.get(to)) {
        socket.to(socketId).emit('typing', { from: userId, isTyping });
      }
    }
  });
}

module.exports = { registerChatHandlers };
