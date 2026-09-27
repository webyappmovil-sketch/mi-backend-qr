import sequelize from '../config/database.js';
import SuperAdmin from './SuperAdmin.js';
import Negocio from './Negocio.js';
import ConfiguracionQR from './ConfiguracionQR.js';
import PedidoImpresion from './PedidoImpresion.js';
import ClienteCapturado from './ClienteCapturado.js';
import Escaneo from './Escaneo.js';

// Relaciones
Negocio.hasMany(ConfiguracionQR, { foreignKey: 'negocio_id', as: 'qrs' });
ConfiguracionQR.belongsTo(Negocio, { foreignKey: 'negocio_id', as: 'negocio' });

Negocio.hasMany(PedidoImpresion, { foreignKey: 'negocio_id', as: 'pedidos' });
PedidoImpresion.belongsTo(Negocio, { foreignKey: 'negocio_id', as: 'negocio' });

Negocio.hasMany(ClienteCapturado, { foreignKey: 'negocio_id', as: 'clientes' });
ClienteCapturado.belongsTo(Negocio, { foreignKey: 'negocio_id', as: 'negocio' });

Negocio.hasMany(Escaneo, { foreignKey: 'negocio_id', as: 'escaneos' });
Escaneo.belongsTo(Negocio, { foreignKey: 'negocio_id', as: 'negocio' });
ConfiguracionQR.hasMany(Escaneo, { foreignKey: 'qr_id', as: 'escaneos' });
Escaneo.belongsTo(ConfiguracionQR, { foreignKey: 'qr_id', as: 'qr' });

export {
  sequelize,
  SuperAdmin,
  Negocio,
  ConfiguracionQR,
  PedidoImpresion,
  ClienteCapturado,
  Escaneo
};
