const db = require('../db');

// Map<userId, Set<socketId>>
const onlineUsers = new Map();

// Map<socketId, 'app'|'service'>
const socketTypes = new Map();

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

async function getAcceptedContactIds(userId) {
  const rows = await db.all(`
    SELECT CASE
      WHEN user_id = ? THEN contact_id
      ELSE user_id
    END AS contact_id
    FROM contacts
    WHERE (user_id = ? OR contact_id = ?)
      AND status = 'accepted'
  `, [userId, userId, userId]);

  return rows.map(r => r.contact_id);
}

async function broadcastPresence(userId, online) {
  const contactIds = await getAcceptedContactIds(userId);

  for (const contactId of contactIds) {
    if (onlineUsers.has(contactId)) {
      for (const socketId of onlineUsers.get(contactId)) {
        ioInstance.to(socketId).emit('presence:update', { userId, online });
      }
    }
  }
}

function hasAppSocket(userId) {
  if (!onlineUsers.has(userId)) return false;
  for (const socketId of onlineUsers.get(userId)) {
    if (socketTypes.get(socketId) !== 'service') return true;
  }
  return false;
}

function addSocket(userId, socketId, socketType = 'app') {
  // Cancel any pending offline timer
  if (offlineTimers.has(userId)) {
    clearTimeout(offlineTimers.get(userId));
    offlineTimers.delete(userId);
  }

  socketTypes.set(socketId, socketType);

  // Only broadcast presence for 'app' sockets
  const hadAppSocket = hasAppSocket(userId);

  if (!onlineUsers.has(userId)) {
    onlineUsers.set(userId, new Set());
  }
  onlineUsers.get(userId).add(socketId);

  if (socketType !== 'service' && !hadAppSocket) {
    broadcastPresence(userId, true);
  }
}

function removeSocket(userId, socketId) {
  if (!onlineUsers.has(userId)) return;

  const socketType = socketTypes.get(socketId) || 'app';
  socketTypes.delete(socketId);

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
  } else if (socketType !== 'service') {
    // An app socket disconnected — check if any app sockets remain
    if (!hasAppSocket(userId)) {
      const timer = setTimeout(() => {
        offlineTimers.delete(userId);
        if (!hasAppSocket(userId)) {
          broadcastPresence(userId, false);
        }
      }, 5000);
      offlineTimers.set(userId, timer);
    }
  }
}

module.exports = {
  setIO,
  getIO,
  getOnlineUsers,
  isUserOnline,
  hasAppSocket,
  getAcceptedContactIds,
  addSocket,
  removeSocket,
};
