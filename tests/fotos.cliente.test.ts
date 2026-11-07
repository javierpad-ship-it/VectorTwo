import { describe, expect, it } from "vitest";
import {
  avisoSobrantes,
  borradorDeFicha,
  CALIDADES_FOTO,
  CALIDADES_MINIATURA,
  codificarHastaCaber,
  contadorFotos,
  cuerpoFichaLinea,
  cupoDeFotos,
  fichaActualDeConflicto,
  fichaCambio,
  LIMITES_SUBIDA,
  MAX_BYTES_ORIGINAL,
  motivoArchivoRechazado,
  pasosDeReduccion,
  seleccionarArchivos,
  textoFichaLinea,
} from "../src/lib/fotos/cliente";
import { dimensionesDestino } from "../src/lib/fotos/dimensiones";
import { fichaLineaSchema } from "../src/lib/fotos/esquemas";
import { LADO_MAX_FOTO, LADO_MAX_MINIATURA, MAX_BYTES_FOTO, MAX_BYTES_MINIATURA, MAX_FOTOS_POR_LINEA } from "../src/lib/fotos/constantes";

/** Lógica pura de la subida de fotos en el navegador (08c, §4.3): qué se acepta, cuántas caben, cómo se reduce y la ficha de la línea. */

const archivo = (size: number, type = "image/jpeg") => ({ size, type, name: `f${size}.jpg` });

describe("límites de la subida: los mismos que exige el servidor", () => {
  it("coinciden con las constantes del servidor (800 px / 400 KB y 320 px / 60 KB)", () => {
    expect(LIMITES_SUBIDA).toEqual({ fotoLado: LADO_MAX_FOTO, fotoBytes: MAX_BYTES_FOTO, miniaturaLado: LADO_MAX_MINIATURA, miniaturaBytes: MAX_BYTES_MINIATURA });
    expect(LADO_MAX_FOTO).toBe(800);
    expect(MAX_BYTES_FOTO).toBe(400 * 1024);
    expect(MAX_BYTES_MINIATURA).toBe(60 * 1024);
  });
  it("las calidades se prueban de mejor a peor y arrancan en 0,82 (foto) y 0,75 (miniatura)", () => {
    expect([...CALIDADES_FOTO]).toEqual([0.82, 0.72, 0.62]);
    expect(CALIDADES_MINIATURA[0]).toBe(0.75);
    for (const q of [CALIDADES_FOTO, CALIDADES_MINIATURA]) expect([...q]).toEqual([...q].sort((a, b) => b - a));
  });
});

describe("motivoArchivoRechazado", () => {
  it("acepta una imagen normal y un archivo sin tipo declarado (algunos teléfonos)", () => {
    expect(motivoArchivoRechazado(archivo(3_000_000))).toBeNull();
    expect(motivoArchivoRechazado(archivo(3_000_000, ""))).toBeNull();
    expect(motivoArchivoRechazado(archivo(1_000, "image/heic"))).toBeNull();
  });
  it("rechaza los originales de más de 30 MB, los vacíos y los que no son imagen", () => {
    expect(motivoArchivoRechazado(archivo(MAX_BYTES_ORIGINAL))).toBeNull();
    expect(motivoArchivoRechazado(archivo(MAX_BYTES_ORIGINAL + 1))).toMatch(/30 MB/);
    expect(motivoArchivoRechazado(archivo(0))).toMatch(/vacío/);
    expect(motivoArchivoRechazado(archivo(100, "application/pdf"))).toMatch(/no es una imagen/);
  });
});

describe("cupo y selección (hasta 3 fotos por línea)", () => {
  it("el cupo descuenta las activas y las que se están subiendo, y nunca es negativo", () => {
    expect(MAX_FOTOS_POR_LINEA).toBe(3);
    expect(cupoDeFotos(0, 0)).toBe(3);
    expect(cupoDeFotos(1, 1)).toBe(1);
    expect(cupoDeFotos(3, 0)).toBe(0);
    expect(cupoDeFotos(2, 5)).toBe(0);
    expect(cupoDeFotos(-1, -1)).toBe(3);
  });

  it("de cinco archivos con cupo 2 acepta los dos primeros en orden y cuenta los sobrantes; los inválidos no gastan cupo", () => {
    const a = [archivo(10), archivo(20, "application/pdf"), archivo(30), archivo(40), archivo(MAX_BYTES_ORIGINAL + 1)];
    const r = seleccionarArchivos(a, 2);
    expect(r.aceptados.map((x) => x.size)).toEqual([10, 30]);
    expect(r.sobrantes).toBe(1);
    expect(r.rechazados.map((x) => x.archivo.size)).toEqual([20, MAX_BYTES_ORIGINAL + 1]);
  });

  it("con cupo 0 no acepta ninguno", () => {
    const r = seleccionarArchivos([archivo(10), archivo(20)], 0);
    expect(r.aceptados).toEqual([]);
    expect(r.sobrantes).toBe(2);
  });

  it("avisoSobrantes dice cuántas caben y cuántas se dejaron", () => {
    expect(avisoSobrantes(0, 2)).toBeNull();
    expect(avisoSobrantes(1, 2)).toBe("Solo caben 2 fotos más: 1 no se subió.");
    expect(avisoSobrantes(2, 1)).toBe("Solo cabe 1 foto más: 2 no se subieron.");
    expect(avisoSobrantes(1, 0)).toBe("La línea ya tiene 3 fotos: 1 no se subió.");
  });

  it("el contador se lee «2/3» y no pasa de 3/3", () => {
    expect(contadorFotos(0)).toBe("0/3");
    expect(contadorFotos(2)).toBe("2/3");
    expect(contadorFotos(7)).toBe("3/3");
  });
});

describe("pasosDeReduccion: reducir de a ×2 para que la foto salga nítida (§4.3, paso 3)", () => {
  it("4000×3000 → 800×600 pasa por 2000×1500 y 1000×750 y termina en el destino", () => {
    const destino = dimensionesDestino(4000, 3000, 800);
    expect(destino).toEqual({ ancho: 800, alto: 600 });
    expect(pasosDeReduccion({ ancho: 4000, alto: 3000 }, destino)).toEqual([
      { ancho: 2000, alto: 1500 },
      { ancho: 1000, alto: 750 },
      { ancho: 800, alto: 600 },
    ]);
  });
  it("una reducción de menos de ×2 es un solo paso, y ninguno pasa de ×2 sobre el anterior", () => {
    expect(pasosDeReduccion({ ancho: 1200, alto: 900 }, { ancho: 800, alto: 600 })).toEqual([{ ancho: 800, alto: 600 }]);
    const pasos = pasosDeReduccion({ ancho: 6000, alto: 4000 }, { ancho: 800, alto: 533 });
    let previo = { ancho: 6000, alto: 4000 };
    for (const p of pasos) {
      expect(previo.ancho / p.ancho).toBeLessThanOrEqual(2.0001);
      previo = p;
    }
    expect(pasos[pasos.length - 1]).toEqual({ ancho: 800, alto: 533 });
  });
  it("un origen del tamaño exacto del destino no necesita pasos (se vuelve a dibujar una vez para quitar metadatos)", () => {
    expect(pasosDeReduccion({ ancho: 600, alto: 400 }, { ancho: 600, alto: 400 })).toEqual([]);
  });
  it("la miniatura de 4000×3000 llega a 320×240", () => {
    const destino = dimensionesDestino(4000, 3000, 320);
    expect(destino).toEqual({ ancho: 320, alto: 240 });
    expect(pasosDeReduccion({ ancho: 800, alto: 600 }, destino).at(-1)).toEqual(destino);
  });
  it("datos inválidos no producen pasos", () => {
    expect(pasosDeReduccion({ ancho: 0, alto: 10 }, { ancho: 5, alto: 5 })).toEqual([]);
  });
});

describe("codificarHastaCaber: la primera calidad que cabe", () => {
  const blob = (size: number) => ({ size });

  it("sube con 0,82 si cabe y no prueba las demás", async () => {
    const probadas: number[] = [];
    const r = await codificarHastaCaber(async (q) => (probadas.push(q), blob(300_000)), CALIDADES_FOTO, MAX_BYTES_FOTO);
    expect(r?.size).toBe(300_000);
    expect(probadas).toEqual([0.82]);
  });
  it("si pesa más de 400 KB prueba 0,72 y después 0,62", async () => {
    const pesos: Record<number, number> = { 0.82: 450_000, 0.72: 420_000, 0.62: 380_000 };
    const probadas: number[] = [];
    const r = await codificarHastaCaber(async (q) => (probadas.push(q), blob(pesos[q])), CALIDADES_FOTO, MAX_BYTES_FOTO);
    expect(r?.size).toBe(380_000);
    expect(probadas).toEqual([0.82, 0.72, 0.62]);
  });
  it("400 KB justos caben; 400 KB + 1 no", async () => {
    expect(await codificarHastaCaber(async () => blob(MAX_BYTES_FOTO), [0.8], MAX_BYTES_FOTO)).not.toBeNull();
    expect(await codificarHastaCaber(async () => blob(MAX_BYTES_FOTO + 1), [0.8], MAX_BYTES_FOTO)).toBeNull();
  });
  it("si ninguna calidad alcanza, o el navegador no puede codificar, devuelve null", async () => {
    expect(await codificarHastaCaber(async () => blob(900_000), CALIDADES_FOTO, MAX_BYTES_FOTO)).toBeNull();
    expect(await codificarHastaCaber(async () => null, CALIDADES_FOTO, MAX_BYTES_FOTO)).toBeNull();
    expect(await codificarHastaCaber(async () => blob(0), CALIDADES_FOTO, MAX_BYTES_FOTO)).toBeNull();
  });
  it("la miniatura baja de calidad hasta los 60 KB", async () => {
    const r = await codificarHastaCaber(async (q) => blob(q > 0.6 ? 70_000 : 50_000), CALIDADES_MINIATURA, MAX_BYTES_MINIATURA);
    expect(r?.size).toBe(50_000);
  });
});

describe("ficha de la línea: descripción y modelo con `antes` para el control de concurrencia", () => {
  const guardada = { descripcion: "Jean slim azul medio", modelo: "DL-2231" };

  it("el cuerpo lleva lo nuevo recortado (vacío = null) y, en `antes`, lo que vio el formulario", () => {
    const cuerpo = cuerpoFichaLinea(guardada, { descripcion: "  Jean recto  ", modelo: "   " });
    expect(cuerpo).toEqual({ descripcion: "Jean recto", modelo: null, antes: { descripcion: "Jean slim azul medio", modelo: "DL-2231" } });
  });
  it("el cuerpo pasa el esquema del servidor (estricto, sin `revision`)", () => {
    const r = fichaLineaSchema.safeParse(cuerpoFichaLinea({ descripcion: null, modelo: null }, { descripcion: "Jean", modelo: "X-1" }));
    expect(r.success).toBe(true);
    expect(fichaLineaSchema.safeParse({ ...cuerpoFichaLinea(guardada, { descripcion: "a", modelo: "b" }), revision: 3 }).success).toBe(false);
  });
  it("detecta si hubo cambio comparando recortado y tratando vacío como sin texto", () => {
    expect(fichaCambio(guardada, borradorDeFicha(guardada))).toBe(false);
    expect(fichaCambio(guardada, { descripcion: " Jean slim azul medio ", modelo: "DL-2231" })).toBe(false);
    expect(fichaCambio(guardada, { descripcion: "Otra", modelo: "DL-2231" })).toBe(true);
    expect(fichaCambio({ descripcion: null, modelo: null }, { descripcion: "", modelo: " " })).toBe(false);
    expect(fichaCambio(guardada, { descripcion: "Jean slim azul medio", modelo: "" })).toBe(true);
  });
  it("lee `actual` de un 409 linea_cambio y descarta lo mal formado", () => {
    expect(fichaActualDeConflicto({ actual: { descripcion: "Otra", modelo: null } })).toEqual({ descripcion: "Otra", modelo: null });
    expect(fichaActualDeConflicto({ actual: { descripcion: 3, modelo: "M" } })).toEqual({ descripcion: null, modelo: "M" });
    expect(fichaActualDeConflicto({})).toBeNull();
    expect(fichaActualDeConflicto(null)).toBeNull();
  });
  it("el texto de la línea une descripción y modelo, o dice que no hay", () => {
    expect(textoFichaLinea(guardada)).toBe("Jean slim azul medio · modelo DL-2231");
    expect(textoFichaLinea({ descripcion: null, modelo: "DL-2231" })).toBe("modelo DL-2231");
    expect(textoFichaLinea({ descripcion: null, modelo: null })).toBe("Sin descripción ni modelo");
  });
});
