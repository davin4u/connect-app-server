const { getOnlineUsers, hasAppSocket, getUserSocketCounts } = require('./presence');
const db = require('../db');

// Map<callKey, startTime> for tracking call duration (stats)
const activeCalls = new Map();

// Map<callKey, { offerTime, answerTime, callerId, calleeId }> for call phase timing
const callTimings = new Map();

// Map<callKey, { caller: {host,srflx,relay,prflx}, callee: {host,srflx,relay,prflx} }>
const callIceCounts = new Map();

const DEBUG_ICE = process.env.DEBUG_ICE === 'true';

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
     ON CONFLICT(date) DO UPDATE SET ${column} = daily_stats.${column} + ?`,
    [today, value, value]
  );
}

function formatIceCounts(counts) {
  const parts = [`${counts.host} host`, `${counts.srflx} srflx`, `${counts.relay} relay`];
  if (counts.prflx > 0) parts.push(`${counts.prflx} prflx`);
  return parts.join(', ');
}

function logCallSummary(callKey) {
  const timing = callTimings.get(callKey);
  const ice = callIceCounts.get(callKey);
  if (!timing) return;

  const now = Date.now();
  const parts = [];

  if (timing.answerTime) {
    const offerToAnswer = ((timing.answerTime - timing.offerTime) / 1000).toFixed(1);
    const answerToEnd = ((now - timing.answerTime) / 1000).toFixed(1);
    parts.push(`offer→answer ${offerToAnswer}s, answer→end ${answerToEnd}s`);
  } else {
    const offerToEnd = ((now - timing.offerTime) / 1000).toFixed(1);
    parts.push(`offer→end ${offerToEnd}s (no answer)`);
  }

  if (ice) {
    parts.push(`caller ICE: ${formatIceCounts(ice.caller)} | callee ICE: ${formatIceCounts(ice.callee)}`);
  }

  console.log(`[signaling] call summary ${timing.callerId} → ${timing.calleeId}: ${parts.join(' | ')}`);

  callTimings.delete(callKey);
  callIceCounts.delete(callKey);
}

function initCallTracking(callKey, callerId, calleeId) {
  callTimings.set(callKey, { offerTime: Date.now(), answerTime: null, callerId, calleeId });
  callIceCounts.set(callKey, {
    caller: { host: 0, srflx: 0, relay: 0, prflx: 0 },
    callee: { host: 0, srflx: 0, relay: 0, prflx: 0 },
  });
}

function registerSignalingHandlers(socket) {
  const userId = socket.userId;
  const socketType = socket.socketType || 'app';

  // call:offer
  socket.on('call:offer', async (data) => {
    console.log(`[signaling] call:offer from ${userId} (via ${socketType} socket) → ${data?.to}, callType: ${data?.callType || 'voice'}, sdp length: ${data?.sdp?.length}`);
    const { to, sdp } = data;
    if (!to || !sdp) {
      console.log(`[signaling] call:offer DROPPED: missing fields. to=${to}, sdp=${!!sdp}`);
      return;
    }

    const onlineUsers = getOnlineUsers();
    const targetCounts = getUserSocketCounts(to);

    if (!onlineUsers.has(to)) {
      console.log(`[signaling] call:unavailable sent to ${userId}: ${to} is completely offline`);
      return socket.emit('call:unavailable', {});
    }

    if (!hasAppSocket(to)) {
      console.log(`[signaling] call:unavailable sent to ${userId}: ${to} has 0 app sockets, ${targetCounts.service} service sockets`);
      return socket.emit('call:unavailable', {});
    }

    // Look up caller's display name for incoming call notification
    const caller = await db.get('SELECT display_name FROM users WHERE id = ?', [userId]);
    const callerName = caller ? caller.display_name : 'Unknown';

    for (const socketId of onlineUsers.get(to)) {
      socket.to(socketId).emit('call:offer', { from: userId, sdp, callType: data.callType || 'voice', callerName });
    }
    console.log(`[signaling] call:offer forwarded to ${to} (sockets: ${targetCounts.app} app, ${targetCounts.service} service)`);

    // Track call timing
    const callKey = getCallKey(userId, to);
    initCallTracking(callKey, userId, to);

    // Increment daily call stats
    const callColumn = (data.callType === 'video') ? 'video_calls' : 'audio_calls';
    incrementDailyStat(callColumn).catch(err => console.error('[stats] Failed to increment call stat:', err));
  });

  // call:answer
  socket.on('call:answer', (data) => {
    const { to, sdp } = data;
    const callKey = to ? getCallKey(userId, to) : null;
    const timing = callKey ? callTimings.get(callKey) : null;
    const elapsed = timing ? ` (${((Date.now() - timing.offerTime) / 1000).toFixed(1)}s after offer)` : '';

    console.log(`[signaling] call:answer from ${userId} (via ${socketType} socket) → ${to}, sdp length: ${sdp?.length}${elapsed}`);

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
      activeCalls.set(callKey, Date.now());

      // Record answer time for diagnostics
      if (timing) {
        timing.answerTime = Date.now();
      }
    } else {
      console.log(`[signaling] call:answer DROPPED: ${to} is offline`);
    }
  });

  // call:ice
  socket.on('call:ice', (data) => {
    const { to, candidate } = data;
    const candStr = candidate?.candidate || '';
    const typeMatch = candStr.match(/typ (\w+)/);
    const candType = typeMatch ? typeMatch[1] : 'unknown';

    if (DEBUG_ICE) {
      console.log(`[signaling] call:ice from ${userId} (via ${socketType} socket) → ${to}, type: ${candType}, candidate: ${candStr}`);
    }

    if (!to || !candidate) {
      console.log(`[signaling] call:ice DROPPED: missing fields`);
      return;
    }

    // Accumulate ICE candidate counts for end-of-call summary
    const callKey = getCallKey(userId, to);
    const ice = callIceCounts.get(callKey);
    if (ice) {
      const callTiming = callTimings.get(callKey);
      const role = (callTiming && callTiming.callerId === userId) ? 'caller' : 'callee';
      const bucket = ice[role];
      if (bucket[candType] !== undefined) {
        bucket[candType]++;
      } else {
        bucket[candType] = 1;
      }
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
    const { to } = data;
    const callKey = to ? getCallKey(userId, to) : null;
    const timing = callKey ? callTimings.get(callKey) : null;

    let elapsed = '';
    if (timing) {
      if (timing.answerTime) {
        const sinceAnswerMs = Date.now() - timing.answerTime;
        const sinceAnswer = (sinceAnswerMs / 1000).toFixed(1);
        elapsed = ` (${sinceAnswer}s after answer${sinceAnswerMs >= 30000 ? ' — likely ICE timeout' : ''})`;
      } else {
        const sinceOffer = ((Date.now() - timing.offerTime) / 1000).toFixed(1);
        elapsed = ` (${sinceOffer}s after offer, no answer)`;
      }
    }

    console.log(`[signaling] call:hangup from ${userId} (via ${socketType} socket) → ${to}${elapsed}`);
    if (!to) return;

    const onlineUsers = getOnlineUsers();
    if (onlineUsers.has(to)) {
      for (const socketId of onlineUsers.get(to)) {
        socket.to(socketId).emit('call:hangup', { from: userId });
      }
    }

    // Log call summary before cleanup
    if (callKey) {
      logCallSummary(callKey);
    }

    // Track call duration for daily stats
    if (callKey) {
      const startTime = activeCalls.get(callKey);
      if (startTime) {
        activeCalls.delete(callKey);
        const durationSeconds = Math.round((Date.now() - startTime) / 1000);
        if (durationSeconds > 0) {
          incrementDailyStat('completed_calls').catch(err => console.error('[stats] Failed to increment completed_calls:', err));
          incrementDailyStat('total_call_duration_seconds', durationSeconds).catch(err => console.error('[stats] Failed to increment call duration:', err));
        }
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
    const { to } = data;
    const callKey = to ? getCallKey(userId, to) : null;
    const timing = callKey ? callTimings.get(callKey) : null;
    const elapsed = timing ? ` (${((Date.now() - timing.offerTime) / 1000).toFixed(1)}s after offer)` : '';

    console.log(`[signaling] call:reject from ${userId} (via ${socketType} socket) → ${to}${elapsed}`);
    if (!to) return;

    const onlineUsers = getOnlineUsers();
    if (onlineUsers.has(to)) {
      for (const socketId of onlineUsers.get(to)) {
        socket.to(socketId).emit('call:reject', { from: userId });
      }
    }

    // Log call summary before cleanup
    if (callKey) {
      logCallSummary(callKey);
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

  // Log call summary and clean up timing/ICE tracking for disconnected user
  for (const key of [...callTimings.keys()]) {
    if (key.split(':').includes(userId)) {
      logCallSummary(key);
    }
  }
}

module.exports = { registerSignalingHandlers, cleanupCallTracking };
