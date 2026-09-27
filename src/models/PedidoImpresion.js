import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const PedidoImpresion = sequelize.define('PedidoImpresion', {
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
  tipo_material: {
    type: DataTypes.ENUM('Vinilo', 'Papel'),
    allowNull: false
  },
  direccion_envio_completa: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  estado: {
    type: DataTypes.ENUM('Pendiente', 'Enviado', 'Entregado'),
    allowNull: false,
    defaultValue: 'Pendiente'
  },
  nombre_contacto: {
    type: DataTypes.STRING(150),
    allowNull: true
  },
  telefono_contacto: {
    type: DataTypes.STRING(20),
    allowNull: true
  },
  archivo_qr_url: {
    type: DataTypes.STRING(512),
    allowNull: true
  },
  notas_admin: {
    type: DataTypes.TEXT,
    allowNull: true
  }
}, {
  tableName: 'pedidos_impresion',
  indexes: [
    { fields: ['estado'] },
    { fields: ['negocio_id'] }
  ]
});

export default PedidoImpresion;
