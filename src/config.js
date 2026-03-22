require('dotenv').config();

module.exports = {
  PORT: parseInt(process.env.PORT, 10) || 3000,
  DB_TYPE: process.env.DB_TYPE || 'sqlite',       // 'sqlite' or 'postgres'
  DB_PATH: process.env.DB_PATH || './data/messenger.db',  // sqlite only
  DATABASE_URL: process.env.DATABASE_URL || '',           // postgres only
  POW_DIFFICULTY: parseInt(process.env.POW_DIFFICULTY, 10) || 20,
  ADMIN_SECRET: process.env.ADMIN_SECRET || '',
};
