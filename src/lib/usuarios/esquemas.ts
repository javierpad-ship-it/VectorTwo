import { z } from "zod";
import { ROLES } from "@/lib/auth/roles";

export const MIN_PASSWORD = 8;

const password = z
  .string()
  .min(MIN_PASSWORD, `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`);

export const crearUsuarioSchema = z.object({
  email: z.email("Correo inválido.").transform((v) => v.trim().toLowerCase()),
  password,
  nombre: z.string().trim().max(120).optional().nullable(),
  rol: z.enum(ROLES),
});

/** Todos opcionales: se actualiza solo lo que llega. */
export const editarUsuarioSchema = z
  .object({
    nombre: z.string().trim().max(120).nullable(),
    rol: z.enum(ROLES),
    activo: z.boolean(),
    password,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "No hay nada que actualizar." });

export type CrearUsuario = z.infer<typeof crearUsuarioSchema>;
export type EditarUsuario = z.infer<typeof editarUsuarioSchema>;
