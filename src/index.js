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

const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts, try again later' },
});

// Routes
app.use('/api/register', registerLimiter);
app.use('/api/login', loginLimiter);
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
