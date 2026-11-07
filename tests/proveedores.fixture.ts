/** Proveedores inventados de las pruebas de 08c (ficha §0, «sin datos reales»). */
export const PROVEEDORES_PRUEBA = [
  { id: "10000000-0000-4000-8000-000000000001", nombre: "Proveedor Norte", activo: true },
  { id: "10000000-0000-4000-8000-000000000002", nombre: "Feria Sur", activo: true },
  { id: "10000000-0000-4000-8000-000000000003", nombre: "Textiles Delta Ltd.", activo: true },
  { id: "10000000-0000-4000-8000-000000000004", nombre: "Hilados Andinos SAC", activo: true },
] as const;

/** Una ficha mínima válida (modo ficha). */
export const FICHA_VALIDA = {
  nombre: "Feria Norte",
  pais: "China",
  region: "Zhejiang",
  ciudad: "Ningbo",
  identificacion: "TAX-0001",
  puerto_embarque: "Ningbo",
  incoterm: "FOB",
  moneda: "USD",
  plazo_produccion_dias: 45,
  plazo_transito_dias: 35,
  condiciones_pago: "30 % adelanto, 70 % contra BL",
  contactos: [{ nombre: "Ana Prueba", cargo: "Ventas", telefono: "+86 000 0000", correo: "ana@ejemplo.com", es_principal: true }],
};
