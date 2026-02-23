const http = require('http');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const config = require('./config');

// Initialize DB (runs schema creation on require)
require('./db');

const authRoutes = require('./routes/auth');
const contactsRoutes = require('./routes/contacts');
const { initSocketIO } = require('./socket');

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

// Routes
app.use('/api/pow/challenge', powChallengeLimiter);
app.use('/api/register', registerLimiter);
app.use('/api/recover', recoverLimiter);
app.use('/api/generate-name', generateNameLimiter);
app.use('/api', authRoutes);
app.use('/api/contacts', contactsRoutes);

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
