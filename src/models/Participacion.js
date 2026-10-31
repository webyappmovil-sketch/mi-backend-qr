import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

/**
 * Una jugada de ruleta (con o sin premio) o una petición "avísame".
 * Es la base de datos de clientes captados por el formulario.
 */
const Participacion = sequelize.define('Participacion', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  negocio_id: { type: DataTypes.UUID, allowNull: false },
  qr_id: { type: DataTypes.UUID, allowNull: false },
  origen: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'Ruleta' }, // Ruleta | Aviso
  nombre: { type: DataTypes.STRING(80), allowNull: false },
  apellido: { type: DataTypes.STRING(80), allowNull: true },
  telefono: { type: DataTypes.STRING(20), allowNull: false },       // 34XXXXXXXXX
  consentimiento: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  texto_consentimiento: { type: DataTypes.STRING(300), allowNull: true },
  fecha_consentimiento: { type: DataTypes.DATE, allowNull: true },
  premio_indice: { type: DataTypes.INTEGER, allowNull: true },
  premio_texto: { type: DataTypes.STRING(60), allowNull: true },
  es_premio: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  codigo: { type: DataTypes.STRING(20), allowNull: true },
  valido_hasta: { type: DataTypes.DATE, allowNull: true },
  canjeado_en: { type: DataTypes.DATE, allowNull: true }
}, {
  tableName: 'participaciones',
  indexes: [
    { fields: ['qr_id', 'telefono'] },
    { fields: ['negocio_id'] },
    { fields: ['qr_id', 'created_at'] }
  ]
});

export default Participacion;
