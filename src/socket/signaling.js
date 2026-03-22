const { getOnlineUsers } = require('./presence');
const db = require('../db');

// Map<callKey, startTime> for tracking call duration
const activeCalls = new Map();

function getCallKey(userA, userB) {
  return [userA, userB].sort().join(':');
}

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

async function incrementDailyStat(column, value = 1) {
  const today = getToday();
  await db.run(
    `INSERT INTO daily_stats (date, ${column}) VALUES (?, ?)
     ON CONFLICT(date) DO UPDATE SET ${column} = ${column} + ?`,
    [today, value, value]
  );
}

function registerSignalingHandlers(socket) {
  const userId = socket.userId;

  // call:offer
  socket.on('call:offer', async (data) => {
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

    // Look up caller's display name for incoming call notification
    const caller = await db.get('SELECT display_name FROM users WHERE id = ?', [userId]);
    const callerName = caller ? caller.display_name : 'Unknown';

    for (const socketId of onlineUsers.get(to)) {
      socket.to(socketId).emit('call:offer', { from: userId, sdp, callType: data.callType || 'voice', callerName });
    }
    console.log(`[signaling] call:offer forwarded to ${to}`);

    // Increment daily call stats
    const callColumn = (data.callType === 'video') ? 'video_calls' : 'audio_calls';
    incrementDailyStat(callColumn).catch(err => console.error('[stats] Failed to increment call stat:', err));
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

      // Track call start time for duration calculation
      const callKey = getCallKey(userId, to);
      activeCalls.set(callKey, Date.now());
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

    // Track call duration
    const callKey = getCallKey(userId, to);
    const startTime = activeCalls.get(callKey);
    if (startTime) {
      activeCalls.delete(callKey);
      const durationSeconds = Math.round((Date.now() - startTime) / 1000);
      if (durationSeconds > 0) {
        incrementDailyStat('completed_calls').catch(err => console.error('[stats] Failed to increment completed_calls:', err));
        incrementDailyStat('total_call_duration_seconds', durationSeconds).catch(err => console.error('[stats] Failed to increment call duration:', err));
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

function cleanupCallTracking(userId) {
  for (const [key, startTime] of activeCalls) {
    const parts = key.split(':');
    if (parts.includes(userId)) {
      // Record duration stats before deleting (treat disconnect as implicit hangup)
      const durationSeconds = Math.round((Date.now() - startTime) / 1000);
      if (durationSeconds > 0) {
        incrementDailyStat('completed_calls').catch(err => console.error('[stats] Failed to increment completed_calls:', err));
        incrementDailyStat('total_call_duration_seconds', durationSeconds).catch(err => console.error('[stats] Failed to increment call duration:', err));
      }
      activeCalls.delete(key);
    }
  }
}

module.exports = { registerSignalingHandlers, cleanupCallTracking };
