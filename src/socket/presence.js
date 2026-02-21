const db = require('../db');

// Map<userId, Set<socketId>>
const onlineUsers = new Map();

// Offline timers for delayed offline broadcast
const offlineTimers = new Map();

let ioInstance = null;

function setIO(io) {
  ioInstance = io;
}

function getIO() {
  return ioInstance;
}

function getOnlineUsers() {
  return onlineUsers;
}

function isUserOnline(userId) {
  return onlineUsers.has(userId) && onlineUsers.get(userId).size > 0;
}

function getAcceptedContactIds(userId) {
  const rows = db.prepare(`
    SELECT CASE
      WHEN user_id = ? THEN contact_id
      ELSE user_id
    END AS contact_id
    FROM contacts
    WHERE (user_id = ? OR contact_id = ?)
      AND status = 'accepted'
  `).all(userId, userId, userId);

  return rows.map(r => r.contact_id);
}

function broadcastPresence(userId, online) {
  const contactIds = getAcceptedContactIds(userId);

  for (const contactId of contactIds) {
    if (onlineUsers.has(contactId)) {
      for (const socketId of onlineUsers.get(contactId)) {
        ioInstance.to(socketId).emit('presence:update', { userId, online });
      }
    }
  }
}

function addSocket(userId, socketId) {
  // Cancel any pending offline timer
  if (offlineTimers.has(userId)) {
    clearTimeout(offlineTimers.get(userId));
    offlineTimers.delete(userId);
  }

  const isFirstConnection = !onlineUsers.has(userId) || onlineUsers.get(userId).size === 0;

  if (!onlineUsers.has(userId)) {
    onlineUsers.set(userId, new Set());
  }
  onlineUsers.get(userId).add(socketId);

  if (isFirstConnection) {
    broadcastPresence(userId, true);
  }
}

function removeSocket(userId, socketId) {
  if (!onlineUsers.has(userId)) return;

  onlineUsers.get(userId).delete(socketId);

  if (onlineUsers.get(userId).size === 0) {
    onlineUsers.delete(userId);

    // Delay offline broadcast by 5 seconds to handle quick reconnects
    const timer = setTimeout(() => {
      offlineTimers.delete(userId);
      if (!isUserOnline(userId)) {
        broadcastPresence(userId, false);
      }
    }, 5000);

    offlineTimers.set(userId, timer);
  }
}

module.exports = {
  setIO,
  getIO,
  getOnlineUsers,
  isUserOnline,
  getAcceptedContactIds,
  addSocket,
  removeSocket,
};
