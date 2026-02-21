require('dotenv').config();

module.exports = {
  PORT: parseInt(process.env.PORT, 10) || 3000,
  JWT_SECRET: process.env.JWT_SECRET,
  DB_PATH: process.env.DB_PATH || './data/messenger.db',
  BCRYPT_ROUNDS: parseInt(process.env.BCRYPT_ROUNDS, 10) || 12,
};
