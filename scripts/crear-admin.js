/**
 * Crea o actualiza la contraseña del Super Admin de forma segura.
 *
 * Uso (en la Shell de Render, o en local):
 *   ADMIN_PASSWORD='tu-contraseña-larga' node scripts/crear-admin.js
 *
 * Variables:
 *   ADMIN_EMAIL     (opcional) por defecto admin@qrsas.es. Debe coincidir con el de login.
 *   ADMIN_PASSWORD  (obligatoria) mínimo 12 caracteres.
 *   ADMIN_NOMBRE    (opcional)
 *
 * Si el admin ya existe, le CAMBIA la contraseña (úsalo para sustituir la antigua).
 */

import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import { sequelize, SuperAdmin } from '../src/models/index.js';

dotenv.config();

const email = (process.env.ADMIN_EMAIL || 'admin@qrsas.es').toLowerCase().trim();
const password = process.env.ADMIN_PASSWORD || '';
const nombre = process.env.ADMIN_NOMBRE || 'Super Admin';

async function main() {
  if (password.length < 12) {
    console.error('❌ Define ADMIN_PASSWORD con al menos 12 caracteres.');
    process.exit(1);
  }
  if (password === 'Admin123!') {
    console.error('❌ Esa contraseña es pública. Elige otra.');
    process.exit(1);
  }

  await sequelize.authenticate();
  // Solo se asegura de que existan las tablas; NO borra ni altera datos.
  await sequelize.sync();

  const hash = await bcrypt.hash(password, 12);
  const existente = await SuperAdmin.findOne({ where: { email } });

  if (existente) {
    // El hook del modelo solo hashea al crear, así que guardamos el hash ya hecho.
    await existente.update({ password_hash: hash, activo: true });
    console.log(`✅ Contraseña actualizada para ${email}`);
  } else {
    // En creación el hook hashea: pasamos la contraseña en claro.
    await SuperAdmin.create({ email, password_hash: password, nombre });
    console.log(`✅ Super Admin creado: ${email}`);
  }

  await sequelize.close();
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
