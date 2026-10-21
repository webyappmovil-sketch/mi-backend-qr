import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';
import bcrypt from 'bcrypt';

const Vendedor = sequelize.define('Vendedor', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  nombre: {
    type: DataTypes.STRING(200),
    allowNull: false
  },
  email: {
    type: DataTypes.STRING(255),
    allowNull: false,
    unique: true
  },
  telefono: {
    type: DataTypes.STRING(20),
    allowNull: false
  },
  codigo: {
    type: DataTypes.STRING(20),
    allowNull: false,
    unique: true
  },
  estado: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'Activo'
  },
  password_hash: {
    type: DataTypes.STRING(255),
    allowNull: true
  }
}, {
  tableName: 'vendedores',
  hooks: {
    beforeCreate: async (vendedor) => {
      if (vendedor.password_hash && !vendedor.password_hash.startsWith('$2')) {
        vendedor.password_hash = await bcrypt.hash(vendedor.password_hash, 12);
      }
    },
    beforeUpdate: async (vendedor) => {
      if (vendedor.changed('password_hash') && vendedor.password_hash && !vendedor.password_hash.startsWith('$2')) {
        vendedor.password_hash = await bcrypt.hash(vendedor.password_hash, 12);
      }
    }
  }
});

export default Vendedor;
