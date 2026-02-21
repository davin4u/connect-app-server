const { getOnlineUsers } = require('./presence');

function registerSignalingHandlers(socket) {
  const userId = socket.userId;

  // call:offer
  socket.on('call:offer', (data) => {
    const { to, sdp } = data;
    if (!to || !sdp) return;

    const onlineUsers = getOnlineUsers();
    if (!onlineUsers.has(to)) {
      return socket.emit('call:unavailable', {});
    }

    for (const socketId of onlineUsers.get(to)) {
      socket.to(socketId).emit('call:offer', { from: userId, sdp });
    }
  });

  // call:answer
  socket.on('call:answer', (data) => {
    const { to, sdp } = data;
    if (!to || !sdp) return;

    const onlineUsers = getOnlineUsers();
    if (onlineUsers.has(to)) {
      for (const socketId of onlineUsers.get(to)) {
        socket.to(socketId).emit('call:answer', { from: userId, sdp });
      }
    }
  });

  // call:ice
  socket.on('call:ice', (data) => {
    const { to, candidate } = data;
    if (!to || !candidate) return;

    const onlineUsers = getOnlineUsers();
    if (onlineUsers.has(to)) {
      for (const socketId of onlineUsers.get(to)) {
        socket.to(socketId).emit('call:ice', { from: userId, candidate });
      }
    }
  });

  // call:hangup
  socket.on('call:hangup', (data) => {
    const { to } = data;
    if (!to) return;

    const onlineUsers = getOnlineUsers();
    if (onlineUsers.has(to)) {
      for (const socketId of onlineUsers.get(to)) {
        socket.to(socketId).emit('call:hangup', { from: userId });
      }
    }
  });

  // call:reject
  socket.on('call:reject', (data) => {
    const { to } = data;
    if (!to) return;

    const onlineUsers = getOnlineUsers();
    if (onlineUsers.has(to)) {
      for (const socketId of onlineUsers.get(to)) {
        socket.to(socketId).emit('call:reject', { from: userId });
      }
    }
  });
}

module.exports = { registerSignalingHandlers };
