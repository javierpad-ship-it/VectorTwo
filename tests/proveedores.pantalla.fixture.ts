import type { ProveedorFichaApi, ProveedorListadoApi } from "../src/lib/proveedores/tipos-api";

/** Proveedores inventados para las pruebas de las pantallas de 08c (sin datos reales). */

export const listado = (o: Partial<ProveedorListadoApi> & { nombre: string }): ProveedorListadoApi => ({
  id: `id-${o.nombre}`,
  codigo: null,
  pais: null,
  region: null,
  ciudad: null,
  identificacion: null,
  es_intercompany: false,
  nota: null,
  activo: true,
  compras: 0,
  puerto_embarque: null,
  incoterm: null,
  moneda: null,
  completo: false,
  contactos: [],
  ...o,
});

export const fichaDeEjemplo = (): ProveedorFichaApi => ({
  ...listado({ nombre: "Textiles Delta Ltd.", pais: "China", region: "Zhejiang", ciudad: "Ningbo", identificacion: "TAX-0001", puerto_embarque: "Ningbo", incoterm: "FOB", moneda: "USD", completo: true, compras: 2 }),
  contactos: [
    { id: "c1", nombre: "Ana Prueba", cargo: "Ventas", telefono: "+86 000", correo: "ana@ejemplo.com", es_principal: false },
    { id: "c2", nombre: "Luis Prueba", cargo: null, telefono: null, correo: null, es_principal: true },
  ],
  direccion: "Calle 1",
  plazo_produccion_dias: 45,
  plazo_transito_dias: 35,
  condiciones_pago: "30 % adelanto",
  faltan: [],
  creado_por: { nombre: "Planner Uno", at: "2026-10-01T15:00:00.000Z" },
  modificado_por: null,
  revision: 3,
  puede: { editar: true, cambiar_intercompany: false, desactivar: false, eliminar: false },
});
