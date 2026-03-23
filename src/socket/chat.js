const db = require('../db');
const { getOnlineUsers } = require('./presence');

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

function registerChatHandlers(socket) {
  const userId = socket.userId;

  // message:send
  socket.on('message:send', async (data) => {
    console.log(`[chat] message:send from ${userId}`, JSON.stringify(data).slice(0, 200));
    const { id, to, ciphertext, nonce, timestamp } = data;

    if (!id || !to || !ciphertext || !nonce) {
      console.log(`[chat] REJECTED: missing fields. id=${id} to=${to} ciphertext=${!!ciphertext} nonce=${!!nonce}`);
      return socket.emit('error', { message: 'Missing required message fields' });
    }

    // Verify sender and recipient are accepted contacts
    const contact = await db.get(
      'SELECT 1 FROM contacts WHERE user_id = ? AND contact_id = ? AND status = ?',
      [userId, to, 'accepted']
    );

    if (!contact) {
      console.log(`[chat] REJECTED: not contacts. sender=${userId} to=${to}`);
      return socket.emit('error', { message: 'Recipient is not in your contacts' });
    }

    // Store message in DB
    const ts = timestamp || Math.floor(Date.now() / 1000);
    await db.run(
      'INSERT INTO messages (id, sender_id, receiver_id, ciphertext, nonce, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
      [id, userId, to, ciphertext, nonce, ts]
    );

    // Confirm to sender
    socket.emit('message:sent', { id, timestamp: ts });
    console.log(`[chat] message stored & confirmed. id=${id} to=${to}`);

    // Increment daily message stats
    const today = getToday();
    db.run(
      `INSERT INTO daily_stats (date, messages_sent) VALUES (?, 1)
       ON CONFLICT(date) DO UPDATE SET messages_sent = daily_stats.messages_sent + 1`,
      [today]
    ).catch(err => console.error('[stats] Failed to increment messages_sent:', err));

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
  socket.on('message:ack', async (data) => {
    const { messageId } = data;
    if (!messageId) return;

    // Mark as delivered
    const msg = await db.get(
      'SELECT sender_id FROM messages WHERE id = ? AND receiver_id = ?',
      [messageId, userId]
    );

    if (!msg) return;

    // Notify sender
    const onlineUsers = getOnlineUsers();
    if (onlineUsers.has(msg.sender_id)) {
      for (const socketId of onlineUsers.get(msg.sender_id)) {
        socket.to(socketId).emit('message:delivered', { messageId });
      }
    }

    // Delete from server DB — messages live on clients only
    await db.run('DELETE FROM messages WHERE id = ?', [messageId]);
  });

  // message:delete — sender deletes their own message
  socket.on('message:delete', async ({ messageId, to }) => {
    const senderId = userId;

    // If the message still exists on server (undelivered), delete it
    await db.run('DELETE FROM messages WHERE id = ? AND sender_id = ?', [messageId, senderId]);

    // Forward delete event to recipient
    const onlineUsers = getOnlineUsers();
    if (onlineUsers.has(to)) {
      for (const socketId of onlineUsers.get(to)) {
        socket.to(socketId).emit('message:deleted', { messageId, from: senderId });
      }
    } else {
      // Recipient offline — store for later delivery
      const { v4: uuid } = require('uuid');
      await db.run(
        'INSERT INTO pending_events (id, user_id, event_type, payload, timestamp) VALUES (?, ?, ?, ?, ?)',
        [uuid(), to, 'message:deleted', JSON.stringify({ messageId, from: senderId }), Math.floor(Date.now() / 1000)]
      );
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
