const { getOnlineUsers } = require('./presence');

function registerSignalingHandlers(socket) {
  const userId = socket.userId;

  // call:offer
  socket.on('call:offer', (data) => {
    console.log(`[signaling] call:offer from ${userId}, data keys: ${Object.keys(data || {})}, to: ${data?.to}, sdp length: ${data?.sdp?.length}`);
    const { to, sdp } = data;
    if (!to || !sdp) {
      console.log(`[signaling] call:offer DROPPED: missing fields. to=${to}, sdp=${!!sdp}`);
      return;
    }

    const onlineUsers = getOnlineUsers();
    if (!onlineUsers.has(to)) {
      console.log(`[signaling] call:offer REJECTED: ${to} is offline`);
      return socket.emit('call:unavailable', {});
    }

    for (const socketId of onlineUsers.get(to)) {
      socket.to(socketId).emit('call:offer', { from: userId, sdp, callType: data.callType || 'voice' });
    }
    console.log(`[signaling] call:offer forwarded to ${to}`);
  });

  // call:answer
  socket.on('call:answer', (data) => {
    console.log(`[signaling] call:answer from ${userId}, to: ${data?.to}, sdp length: ${data?.sdp?.length}`);
    const { to, sdp } = data;
    if (!to || !sdp) {
      console.log(`[signaling] call:answer DROPPED: missing fields`);
      return;
    }

    const onlineUsers = getOnlineUsers();
    if (onlineUsers.has(to)) {
      for (const socketId of onlineUsers.get(to)) {
        socket.to(socketId).emit('call:answer', { from: userId, sdp });
      }
      console.log(`[signaling] call:answer forwarded to ${to}`);
    } else {
      console.log(`[signaling] call:answer DROPPED: ${to} is offline`);
    }
  });

  // call:ice
  socket.on('call:ice', (data) => {
    const candStr = data?.candidate?.candidate || '';
    const typeMatch = candStr.match(/typ (\w+)/);
    const candType = typeMatch ? typeMatch[1] : 'unknown';
    console.log(`[signaling] call:ice from ${userId}, to: ${data?.to}, type: ${candType}, candidate: ${candStr}`);
    const { to, candidate } = data;
    if (!to || !candidate) {
      console.log(`[signaling] call:ice DROPPED: missing fields`);
      return;
    }

    const onlineUsers = getOnlineUsers();
    if (onlineUsers.has(to)) {
      for (const socketId of onlineUsers.get(to)) {
        socket.to(socketId).emit('call:ice', { from: userId, candidate });
      }
    } else {
      console.log(`[signaling] call:ice DROPPED: ${to} is offline`);
    }
  });

  // call:hangup
  socket.on('call:hangup', (data) => {
    console.log(`[signaling] call:hangup from ${userId}, to: ${data?.to}`);
    const { to } = data;
    if (!to) return;

    const onlineUsers = getOnlineUsers();
    if (onlineUsers.has(to)) {
      for (const socketId of onlineUsers.get(to)) {
        socket.to(socketId).emit('call:hangup', { from: userId });
      }
    }
  });

  // call:toggle-video
  socket.on('call:toggle-video', (data) => {
    console.log(`[signaling] call:toggle-video from ${userId}, to: ${data?.to}, videoEnabled: ${data?.videoEnabled}`);
    const { to, videoEnabled } = data;
    if (!to || videoEnabled === undefined) return;

    const onlineUsers = getOnlineUsers();
    if (onlineUsers.has(to)) {
      for (const socketId of onlineUsers.get(to)) {
        socket.to(socketId).emit('call:toggle-video', { from: userId, videoEnabled });
      }
    }
  });

  // call:reject
  socket.on('call:reject', (data) => {
    console.log(`[signaling] call:reject from ${userId}, to: ${data?.to}`);
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
