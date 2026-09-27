import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const ConfiguracionQR = sequelize.define('ConfiguracionQR', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  negocio_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'negocios',
      key: 'id'
    },
    onDelete: 'CASCADE'
  },
  tipo: {
    type: DataTypes.ENUM('Estatico', 'Dinamico'),
    allowNull: false,
    defaultValue: 'Estatico'
  },
  mensaje_opciones_encoded: {
    type: DataTypes.TEXT,
    allowNull: false,
    comment: 'Mensaje ya URL-encoded para WhatsApp'
  },
  mapeo_respuestas: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {}
  },
  contador_escaneos: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  activo: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  nombre_interno: {
    type: DataTypes.STRING(100),
    allowNull: true
  }
}, {
  tableName: 'configuraciones_qr',
  indexes: [
    { fields: ['negocio_id'] },
    { fields: ['tipo'] }
  ]
});

export default ConfiguracionQR;
