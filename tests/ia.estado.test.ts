import { describe, expect, it } from "vitest";
import { baseMovida, configuracionCambiada, estadoPropuestaGM, libresNuevasSuperanUmbral, type EntradaEstadoGM } from "@/lib/ia/estado";

/** R13 (ficha 07e, §5.3): `estadoPropuestaGM` en su orden, motivos de desactualización, `base_movida` en 2 % y `filas_libres_nuevas` en 5 %. */

const sana: EntradaEstadoGM = {
  ultimo_intento_bloqueado: false,
  ultimo_intento_fallido: false,
  hay_propuesta: true,
  filas_libres: 3,
  huella_historia_hoy: "h",
  huella_historia_guardada: "h",
  libres_sin_cifra_p_gm: 0,
  meta_libre: 22620,
  version_metodo_hoy: 5,
  version_metodo_propuesta: 5,
  capacidad_encendida: true,
  absorbido_pct: 0,
};
const e = (extra: Partial<EntradaEstadoGM>) => estadoPropuestaGM({ ...sana, ...extra });

describe("R13 · estadoPropuestaGM", () => {
  it("al_dia", () => {
    expect(e({})).toEqual({ estado: "al_dia", motivos: [] });
    expect(e({ absorbido_pct: null })).toEqual({ estado: "al_dia", motivos: [] });
  });

  it("bloqueado_privacidad y fallida solo si no hay propuesta válida anterior", () => {
    expect(e({ hay_propuesta: false, ultimo_intento_bloqueado: true }).estado).toBe("bloqueado_privacidad");
    expect(e({ hay_propuesta: false, ultimo_intento_fallido: true }).estado).toBe("fallida");
    expect(e({ hay_propuesta: true, ultimo_intento_bloqueado: true }).estado).toBe("al_dia");
    expect(e({ hay_propuesta: true, ultimo_intento_fallido: true }).estado).toBe("al_dia");
  });

  it("orden: bloqueado antes que fallida, fallida antes que sin_filas_libres, sin_filas_libres antes que sin_propuesta", () => {
    expect(e({ hay_propuesta: false, ultimo_intento_bloqueado: true, ultimo_intento_fallido: true, filas_libres: 0 }).estado).toBe("bloqueado_privacidad");
    expect(e({ hay_propuesta: false, ultimo_intento_fallido: true, filas_libres: 0 }).estado).toBe("fallida");
    expect(e({ hay_propuesta: false, filas_libres: 0 }).estado).toBe("sin_filas_libres");
    expect(e({ hay_propuesta: true, filas_libres: 0 }).estado).toBe("sin_filas_libres");
    expect(e({ hay_propuesta: false }).estado).toBe("sin_propuesta");
  });

  it("desactualizada por historia_cambiada, version_metodo y capacidad_apagada, juntas o por separado", () => {
    expect(e({ huella_historia_hoy: "otra" })).toEqual({ estado: "desactualizada", motivos: ["historia_cambiada"] });
    expect(e({ version_metodo_hoy: 6 })).toEqual({ estado: "desactualizada", motivos: ["version_metodo"] });
    expect(e({ capacidad_encendida: false })).toEqual({ estado: "desactualizada", motivos: ["capacidad_apagada"] });
    expect(e({ huella_historia_hoy: "otra", version_metodo_hoy: 6, capacidad_encendida: false }).motivos).toEqual(["historia_cambiada", "version_metodo", "capacidad_apagada"]);
  });

  it("filas_libres_nuevas cuando las libres sin cifra pesan más del 5 % de Meta_libre", () => {
    // El 5 % de 22 620 es 1 131: exactamente en el umbral no cuenta.
    expect(e({ libres_sin_cifra_p_gm: 1132, meta_libre: 22620 })).toEqual({ estado: "desactualizada", motivos: ["filas_libres_nuevas"] });
    expect(e({ libres_sin_cifra_p_gm: 1131, meta_libre: 22620 }).estado).toBe("al_dia");
    expect(libresNuevasSuperanUmbral(1132, 22620)).toBe(true);
    expect(libresNuevasSuperanUmbral(1131, 22620)).toBe(false);
    expect(libresNuevasSuperanUmbral(0, 0)).toBe(false);
    expect(libresNuevasSuperanUmbral(10, 0)).toBe(true);
    expect(libresNuevasSuperanUmbral(10, null)).toBe(false);
  });

  it("desactualizada manda sobre meta_movida; meta_movida con absorbido > 5 %", () => {
    expect(e({ absorbido_pct: 8.91 })).toEqual({ estado: "meta_movida", motivos: [] });
    expect(e({ absorbido_pct: 5.01 }).estado).toBe("meta_movida");
    expect(e({ absorbido_pct: 5 }).estado).toBe("al_dia");
    expect(e({ absorbido_pct: 4.99 }).estado).toBe("al_dia");
    expect(e({ absorbido_pct: 8.91, huella_historia_hoy: "otra" }).estado).toBe("desactualizada");
  });

  it("sin historia guardada o sin versión de método guardada, la propuesta está desactualizada", () => {
    expect(e({ huella_historia_guardada: null }).motivos).toContain("historia_cambiada");
    expect(e({ version_metodo_propuesta: null }).motivos).toContain("version_metodo");
  });
});

describe("R13 · informativos", () => {
  it("configuracion_cambiada: modelo o prompt distintos de la vigente", () => {
    const p = { modelo: "m1", version_prompt: "v1" };
    expect(configuracionCambiada(p, { modelo: "m1", version_prompt: "v1" })).toBe(false);
    expect(configuracionCambiada(p, { modelo: "m2", version_prompt: "v1" })).toBe(true);
    expect(configuracionCambiada(p, { modelo: "m1", version_prompt: "v2" })).toBe(true);
    expect(configuracionCambiada(p, null)).toBe(false);
  });

  it("base_movida desde más de 2 % (f1 pasa de 10 000 a 10 500: +5 %)", () => {
    expect(baseMovida(10500, 10000)).toBe("base_movida");
    expect(baseMovida(10200, 10000)).toBeNull();
    expect(baseMovida(10201, 10000)).toBe("base_movida");
    expect(baseMovida(9799, 10000)).toBe("base_movida");
    expect(baseMovida(9800, 10000)).toBeNull();
    expect(baseMovida(null, 10000)).toBeNull();
    expect(baseMovida(10, 0)).toBeNull();
  });
});
