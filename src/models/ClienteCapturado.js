import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const ClienteCapturado = sequelize.define('ClienteCapturado', {
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
  telefono_cliente: {
    type: DataTypes.STRING(20),
    allowNull: false
  },
  nombre_perfil_whatsapp: {
    type: DataTypes.STRING(150),
    allowNull: true
  },
  ultima_interaccion: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  veces_interactuado: {
    type: DataTypes.INTEGER,
    defaultValue: 1
  }
}, {
  tableName: 'clientes_capturados',
  indexes: [
    { fields: ['negocio_id', 'telefono_cliente'], unique: true },
    { fields: ['ultima_interaccion'] }
  ]
});

export default ClienteCapturado;
