import { sequelize, SuperAdmin, Negocio, ConfiguracionQR, PedidoImpresion } from '../src/models/index.js';
import dotenv from 'dotenv';

dotenv.config();

async function seed() {
  try {
    console.log('🔄 Sincronizando base de datos...');
    await sequelize.sync({ force: true }); // Borra y recrea todo (solo desarrollo)
    console.log('✅ Tablas creadas');

    // 1. SuperAdmin
    const admin = await SuperAdmin.create({
      email: 'admin@qrsas.es',
      password_hash: 'Admin123!',
      nombre: 'Super Administrador',
      total_ingresos: 0
    });
    console.log(`✅ SuperAdmin creado → ${admin.email}`);

    // 2. Negocio ACTIVO (Plan Pro)
    const negocioActivo = await Negocio.create({
      nombre_empresa: 'Restaurante La Terraza',
      email: 'terraza@ejemplo.com',
      password_hash: 'Negocio123!',
      telefono_whatsapp: '34600111222', // Número de prueba (cámbialo por el tuyo si quieres)
      plan_actual: 'Pro',
      estado_suscripcion: 'Activo',
      fecha_activacion: new Date()
    });

    // Mensaje de ejemplo (ya URL-encoded)
    const mensajeActivo = encodeURIComponent(
      `¡Hola! 👋 Bienvenido a *La Terraza*\n\nElige una opción:\n1️⃣ Ver Carta\n2️⃣ Hacer Reserva\n3️⃣ Hablar con nosotros`
    );

    const qrActivo = await ConfiguracionQR.create({
      negocio_id: negocioActivo.id,
      tipo: 'Dinamico',
      mensaje_opciones_encoded: mensajeActivo,
      mapeo_respuestas: {
        '1': 'https://ejemplo.com/carta.pdf',
        '2': 'https://ejemplo.com/reservas',
        '3': 'humano'
      },
      nombre_interno: 'QR Principal Terraza',
      contador_escaneos: 0
    });

    // 3. Negocio SUSPENDIDO (falta de pago)
    const negocioSuspendido = await Negocio.create({
      nombre_empresa: 'Café Central',
      email: 'cafe@ejemplo.com',
      password_hash: 'Negocio123!',
      telefono_whatsapp: '34600333444',
      plan_actual: 'Business',
      estado_suscripcion: 'Suspendido'
    });

    const mensajeSuspendido = encodeURIComponent('Hola desde Café Central');
    const qrSuspendido = await ConfiguracionQR.create({
      negocio_id: negocioSuspendido.id,
      tipo: 'Dinamico',
      mensaje_opciones_encoded: mensajeSuspendido,
      nombre_interno: 'QR Café Central',
      contador_escaneos: 12
    });

    // 4. Negocio PENDIENTE DE IMPRESIÓN (Plan Starter)
    const negocioPendiente = await Negocio.create({
      nombre_empresa: 'Peluquería Estilo',
      email: 'estilo@ejemplo.com',
      password_hash: 'Negocio123!',
      telefono_whatsapp: '34600555666',
      plan_actual: 'Starter',
      estado_suscripcion: 'Pendiente_Impresion'
    });

    const mensajePendiente = encodeURIComponent('Hola, bienvenido a Peluquería Estilo');
    const qrPendiente = await ConfiguracionQR.create({
      negocio_id: negocioPendiente.id,
      tipo: 'Estatico',
      mensaje_opciones_encoded: mensajePendiente,
      nombre_interno: 'QR Estático Estilo',
      contador_escaneos: 0
    });

    // Pedido de impresión asociado al Starter
    await PedidoImpresion.create({
      negocio_id: negocioPendiente.id,
      tipo_material: 'Vinilo',
      direccion_envio_completa: 'Calle Mayor 15, 3ºB, 28013 Madrid',
      estado: 'Pendiente',
      nombre_contacto: 'María López',
      telefono_contacto: '600555666'
    });

    // ===== RESUMEN PARA EL USUARIO =====
    console.log('\n==================================================');
    console.log('✅ DATOS DE PRUEBA CREADOS CORRECTAMENTE');
    console.log('==================================================\n');

    console.log('🟢 QR ACTIVO (redirige a WhatsApp):');
    console.log(`   http://localhost:3000/r/${qrActivo.id}`);
    console.log(`   Negocio: ${negocioActivo.nombre_empresa}`);
    console.log(`   Teléfono WA: ${negocioActivo.telefono_whatsapp}\n`);

    console.log('🔴 QR SUSPENDIDO (pantalla de inactivo):');
    console.log(`   http://localhost:3000/r/${qrSuspendido.id}`);
    console.log(`   Negocio: ${negocioSuspendido.nombre_empresa}\n`);

    console.log('🟡 QR PENDIENTE DE IMPRESIÓN (pantalla de espera):');
    console.log(`   http://localhost:3000/r/${qrPendiente.id}`);
    console.log(`   Negocio: ${negocioPendiente.nombre_empresa}\n`);

    console.log('--------------------------------------------------');
    console.log('Copia cualquiera de las URLs de arriba y ábrela en el navegador.');
    console.log('==================================================\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error en seed:', error);
    process.exit(1);
  }
}

seed();
