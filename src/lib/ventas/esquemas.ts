import { z } from "zod";
import { LIMITES_PREVISUALIZAR, MAX_DICCIONARIO_TANDA, MAX_REPORTE_BYTES, TANDA_CLIENTE } from "./tipos";

/**
 * Esquemas zod de M5 (docs/modulos/05-venta-stock.md, "Contratos de API" y
 * regla 35). Los mensajes van en castellano porque `leerCuerpo` los devuelve
 * tal cual a la pantalla.
 */

const MAX_INT4 = 2_147_483_647;
/** `numeric(14, 2)`: hasta 999 999 999 999,99. */
const MAX_NUMERIC_14_2 = 999_999_999_999.99;

const periodo = z.string("El periodo debe ser texto.").regex(/^\d{4}-(0[1-9]|1[0-2])$/, "El periodo debe tener la forma aaaa-mm.");
const uuid = z.uuid("Identificador inválido.");

// ─── Medidas del mes (archivo o lo enviado) ───

/** Hasta 2 decimales exactos (con tolerancia al ruido de coma flotante, sin mover los montos grandes). */
const soles = (nombre: string) =>
  z
    .number(`${nombre} debe ser un número.`)
    .refine((n) => Number.isInteger(Number((Math.abs(n) * 100).toPrecision(15))), `${nombre} admite hasta 2 decimales.`);

export const medidasSchema = z.object({
  filas: z.number("filas debe ser un número.").int("filas debe ser un entero.").min(0, "filas no puede ser negativo."),
  unidades: z.number("unidades debe ser un número.").int("unidades debe ser un entero."),
  venta_soles: soles("venta_soles"),
  costo_vendido: soles("costo_vendido"),
  stock_unidades: z.number("stock_unidades debe ser un número.").int("stock_unidades debe ser un entero."),
  stock_valorizado: soles("stock_valorizado"),
});

// ─── POST /api/ventas/previsualizar ───

export const previsualizarSchema = z.object({
  tiendas: z.array(z.string().max(200, "Un nombre de tienda supera los 200 caracteres.")).max(LIMITES_PREVISUALIZAR.tiendas, "Demasiadas tiendas distintas."),
  combinaciones: z
    .array(
      z.object({
        genero: z.string().max(200),
        mundo: z.string().max(200),
        linea: z.string().max(200),
        equivalencia: z.string().max(200),
      })
    )
    .max(LIMITES_PREVISUALIZAR.combinaciones, "Demasiadas combinaciones distintas."),
  marcas: z.array(z.string().max(200, "Un nombre de marca supera los 200 caracteres.")).max(LIMITES_PREVISUALIZAR.marcas, "Demasiadas marcas distintas."),
  periodos: z.array(periodo).max(LIMITES_PREVISUALIZAR.periodos, "Demasiados meses distintos."),
});

// ─── POST /api/ventas/marcas-nuevas ───

export const marcasNuevasSchema = z.object({
  nombres: z
    .array(z.string().min(1, "Hay una marca sin nombre.").max(120, "Una marca supera los 120 caracteres."))
    .min(1, "No hay marcas que crear.")
    .max(5_000, "Demasiadas marcas a la vez."),
  agrupacion_marca_id: uuid,
});

// ─── POST /api/ventas/cargas ───

export const abrirCargaSchema = z.object({
  periodo,
  archivo_nombre: z.string("archivo_nombre debe ser texto.").max(255, "El nombre del archivo supera los 255 caracteres."),
  archivo: medidasSchema,
  reporte: z.record(z.string(), z.unknown()).refine((r) => JSON.stringify(r).length <= MAX_REPORTE_BYTES, {
    message: "El reporte de la carga supera los 200 KB.",
  }),
  reemplazar: z.boolean().default(false),
  mes_abierto: z.boolean().default(false),
  forzar_incompleto: z.boolean().default(false),
});

// ─── POST /api/ventas/cargas/[id]/filas ───

const dinero = z.number("Cifra inválida.").refine((n) => Math.abs(n) <= MAX_NUMERIC_14_2, "Una cifra supera el máximo que admite la base.");
const entero4 = z.number("Cifra inválida.").int("Las unidades y el stock deben ser enteros.").min(-MAX_INT4).max(MAX_INT4);

export const tandaSchema = z
  .object({
    tanda: z.number().int().min(1, "El número de tanda empieza en 1."),
    diccionario: z.object({
      tiendas: z.array(uuid).max(MAX_DICCIONARIO_TANDA),
      equivalencias: z.array(uuid).max(MAX_DICCIONARIO_TANDA),
      marcas: z.array(uuid).max(MAX_DICCIONARIO_TANDA),
    }),
    filas: z
      .array(
        z.tuple([
          z.number().int().min(0), // índice en diccionario.tiendas
          z.number().int().min(0), // índice en diccionario.equivalencias
          z.number().int().min(0), // índice en diccionario.marcas
          z.union([z.literal(0), z.literal(1)], "La talla debe ser 0 (CENTRALES) o 1 (EXTREMAS)."),
          entero4, // unidades
          dinero, // venta_soles
          dinero, // costo_vendido
          entero4, // stock_unidades
          dinero, // stock_valorizado
        ])
      )
      .min(1, "La tanda no trae filas.")
      .max(TANDA_CLIENTE, `Una tanda admite hasta ${TANDA_CLIENTE} filas.`),
  })
  .superRefine((t, ctx) => {
    const { tiendas, equivalencias, marcas } = t.diccionario;
    for (let i = 0; i < t.filas.length; i++) {
      const [ti, eq, ma] = t.filas[i];
      if (ti >= tiendas.length || eq >= equivalencias.length || ma >= marcas.length) {
        ctx.addIssue({
          code: "custom",
          path: ["filas", i],
          message: "Una fila apunta a un índice fuera de su diccionario.",
        });
        return;
      }
    }
  });

// ─── POST /api/ventas/cargas/[id]/publicar ───

export const publicarSchema = z.object({ esperado: medidasSchema });
