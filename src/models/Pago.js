import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

/**
 * Registro de cada cobro real recibido por Stripe.
 * `referencia` es única (id de factura o de sesión de Stripe): sirve para no contar
 * ni avisar dos veces el mismo pago cuando llegan el webhook y la página de éxito.
 */
const Pago = sequelize.define('Pago', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  negocio_id: { type: DataTypes.UUID, allowNull: false },
  tipo: { type: DataTypes.STRING(20), allowNull: false },          // Suscripcion | Renovacion | Impresion
  plan: { type: DataTypes.STRING(20), allowNull: true },
  material: { type: DataTypes.STRING(20), allowNull: true },       // Papel | Vinilo
  importe_centimos: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  moneda: { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'eur' },
  referencia: { type: DataTypes.STRING(120), allowNull: false, unique: true },
  pagador_nombre: { type: DataTypes.STRING(160), allowNull: true },
  pagador_email: { type: DataTypes.STRING(200), allowNull: true },
  pagador_telefono: { type: DataTypes.STRING(40), allowNull: true }
}, {
  tableName: 'pagos',
  indexes: [{ fields: ['negocio_id'] }]
});

export default Pago;
