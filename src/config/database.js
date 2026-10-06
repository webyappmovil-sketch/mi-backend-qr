import { Sequelize } from 'sequelize';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defineOpts = {
  underscored: true,
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
};

let sequelize;

// Si existe DATABASE_URL → PostgreSQL (producción / Render + Neon)
// Si no → SQLite local (pruebas en el PC)
if (process.env.DATABASE_URL) {
  sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: 'postgres',
    protocol: 'postgres',
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
    dialectOptions: {
      ssl: process.env.DB_SSL === 'false'
        ? false
        : { require: true, rejectUnauthorized: false }
    },
    define: defineOpts
  });
  console.log('[DB] Usando PostgreSQL (DATABASE_URL)');
} else {
  const storage = process.env.DB_STORAGE || path.join(__dirname, '../../database.sqlite');
  sequelize = new Sequelize({
    dialect: 'sqlite',
    storage,
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
    define: defineOpts
  });
  console.log('[DB] Usando SQLite:', storage);
}

export default sequelize;
