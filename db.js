const { Pool } = require('pg');

const pool = new Pool({
  user: 'toll_user',
  host: 'localhost',
  database: 'toll_db',
  password: 'yourpassword',
  port: 5432,
  ssl: false
});

// Optional: Test connection
pool.connect((err, client, release) => {
  if (err) return console.error('Postgres connection error:', err.stack);
  console.log('✅ PostgreSQL connected');
  release();
});

module.exports = pool;
