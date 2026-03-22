const crypto = require('crypto');
const express = require('express');
const os = require('os');
const fs = require('fs');
const db = require('../db');
const config = require('../config');
const { getConnectionCounts } = require('../socket/presence');

const router = express.Router();

// Bearer token auth middleware (timing-safe comparison)
function adminAuth(req, res, next) {
  if (!config.ADMIN_SECRET) {
    return res.status(503).json({ error: 'Admin API not configured' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.slice(7);
  if (token.length !== config.ADMIN_SECRET.length ||
      !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(config.ADMIN_SECRET))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

router.get('/stats', adminAuth, async (_req, res) => {
  try {
    // User counts
    const now = Math.floor(Date.now() / 1000);
    const startOfToday = now - (now % 86400);
    const sevenDaysAgo = now - (7 * 86400);

    const totalUsers = await db.get('SELECT COUNT(*) as count FROM users');
    const todayUsers = await db.get('SELECT COUNT(*) as count FROM users WHERE created_at >= ?', [startOfToday]);
    const weekUsers = await db.get('SELECT COUNT(*) as count FROM users WHERE created_at >= ?', [sevenDaysAgo]);

    // Undelivered messages
    const undelivered = await db.get('SELECT COUNT(*) as count FROM messages WHERE delivered = 0');

    // Connections
    const connections = getConnectionCounts();

    // System metrics
    const totalMem = os.totalmem();
    const freeMem = os.freemem();

    let diskUsedGb = 0;
    let diskTotalGb = 0;
    try {
      const stats = await fs.promises.statfs('/');
      diskTotalGb = Math.round((stats.bsize * stats.blocks) / (1024 ** 3) * 10) / 10;
      diskUsedGb = Math.round((stats.bsize * (stats.blocks - stats.bfree)) / (1024 ** 3) * 10) / 10;
    } catch {
      // statfs may not be available on all platforms
    }

    // Daily stats
    const dailyStats = await db.all('SELECT * FROM daily_stats ORDER BY date DESC LIMIT 90');

    res.json({
      users: {
        total: totalUsers.count,
        today: todayUsers.count,
        last7d: weekUsers.count,
      },
      messages: {
        undelivered: undelivered.count,
      },
      connections,
      system: {
        ramUsedMb: Math.round((totalMem - freeMem) / (1024 ** 2)),
        ramTotalMb: Math.round(totalMem / (1024 ** 2)),
        cpuLoadAvg: os.loadavg(),
        diskUsedGb,
        diskTotalGb,
        uptimeSeconds: Math.round(process.uptime()),
        nodeVersion: process.version,
      },
      dailyStats,
    });
  } catch (err) {
    console.error('[admin] Stats error:', err);
    res.status(500).json({ error: 'Failed to collect stats' });
  }
});

module.exports = router;
