import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';
import bcrypt from 'bcrypt';

const Negocio = sequelize.define('Negocio', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  nombre_empresa: {
    type: DataTypes.STRING(200),
    allowNull: false
  },
  email: {
    type: DataTypes.STRING(255),
    allowNull: false,
    unique: true,
    validate: { isEmail: true }
  },
  password_hash: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  telefono_whatsapp: {
    type: DataTypes.STRING(20),
    allowNull: false,
    comment: 'Formato internacional sin +, ej: 34612345678'
  },
  plan_actual: {
    type: DataTypes.ENUM('Starter', 'Pro', 'Business'),
    allowNull: false,
    defaultValue: 'Starter'
  },
  estado_suscripcion: {
    type: DataTypes.ENUM('Pendiente_Impresion', 'Activo', 'Suspendido'),
    allowNull: false,
    defaultValue: 'Pendiente_Impresion'
  },
  token_api_whatsapp: {
    type: DataTypes.STRING(512),
    allowNull: true
  },
  fecha_activacion: {
    type: DataTypes.DATE,
    allowNull: true
  },
  fecha_proximo_pago: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  tableName: 'negocios',
  indexes: [
    { fields: ['estado_suscripcion'] },
    { fields: ['plan_actual'] },
    { fields: ['email'] }
  ],
  hooks: {
    beforeCreate: async (negocio) => {
      if (negocio.password_hash) {
        negocio.password_hash = await bcrypt.hash(negocio.password_hash, 12);
      }
    }
  }
});

export default Negocio;
