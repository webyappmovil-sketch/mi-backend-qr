/**
 * Registro individual de cada escaneo del QR
 * Permite gráficas por día y por hora
 */

import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const Escaneo = sequelize.define('Escaneo', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  qr_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'configuraciones_qr', key: 'id' },
    onDelete: 'CASCADE'
  },
  negocio_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'negocios', key: 'id' },
    onDelete: 'CASCADE'
  },
  // user-agent / origen opcional
  user_agent: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  scanned_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'escaneos',
  updatedAt: false,
  indexes: [
    { fields: ['negocio_id', 'scanned_at'] },
    { fields: ['qr_id', 'scanned_at'] }
  ]
});

export default Escaneo;
