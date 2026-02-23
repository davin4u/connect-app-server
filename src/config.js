require('dotenv').config();

module.exports = {
  PORT: parseInt(process.env.PORT, 10) || 3000,
  DB_PATH: process.env.DB_PATH || './data/messenger.db',
  POW_DIFFICULTY: parseInt(process.env.POW_DIFFICULTY, 10) || 20,
};
