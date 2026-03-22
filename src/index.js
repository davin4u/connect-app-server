const http = require('http');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const config = require('./config');

const db = require('./db');
const authRoutes = require('./routes/auth');
const contactsRoutes = require('./routes/contacts');
const adminRoutes = require('./routes/admin');
const { initSocketIO } = require('./socket');

async function start() {
  // Initialize DB (schema creation, cleanup jobs)
  await db.init();

  const app = express();

  // Middleware
  app.use(helmet());
  app.use(cors());
  app.use(express.json());

  // Rate limiting
  const registerLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    message: { error: 'Too many registration attempts, try again later' },
  });

  const powChallengeLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: { error: 'Too many challenge requests, try again later' },
  });

  const recoverLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: { error: 'Too many recovery attempts, try again later' },
  });

  const generateNameLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    message: { error: 'Too many name generation requests, try again later' },
  });

  const adminLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    message: { error: 'Too many admin requests, try again later' },
  });

  // Routes
  app.use('/api/pow/challenge', powChallengeLimiter);
  app.use('/api/register', registerLimiter);
  app.use('/api/recover', recoverLimiter);
  app.use('/api/generate-name', generateNameLimiter);
  app.use('/api', authRoutes);
  app.use('/api/contacts', contactsRoutes);
  app.use('/api/admin', adminLimiter);
  app.use('/api/admin', adminRoutes);

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Create HTTP server and attach Socket.IO
  const server = http.createServer(app);
  initSocketIO(server);

  server.listen(config.PORT, () => {
    console.log(`Server running on port ${config.PORT}`);
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
