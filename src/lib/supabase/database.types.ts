/**
 * Tipos de la base de datos.
 *
 * Verificados el 2026-10-06 contra `generate_typescript_types` del proyecto
 * Supabase `Vector2` (ref tzjsxzmsvvhxyiooihyq): mismas tablas, columnas,
 * obligatoriedad y claves foráneas. Se regeneran después de cada migración.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      agrupacion_estacionalidad_genero: {
        Row: {
          agrupacion_estacionalidad_id: string;
          created_at: string;
          genero_id: string;
          id: string;
          updated_at: string;
        };
        Insert: {
          agrupacion_estacionalidad_id: string;
          created_at?: string;
          genero_id: string;
          id?: string;
          updated_at?: string;
        };
        Update: {
          agrupacion_estacionalidad_id?: string;
          created_at?: string;
          genero_id?: string;
          id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "agrupacion_estacionalidad_genero_agrupacion_id_fkey";
            columns: ["agrupacion_estacionalidad_id"];
            isOneToOne: false;
            referencedRelation: "agrupaciones_estacionalidad";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agrupacion_estacionalidad_genero_genero_id_fkey";
            columns: ["genero_id"];
            isOneToOne: false;
            referencedRelation: "generos";
            referencedColumns: ["id"];
          },
        ];
      };
      agrupaciones_estacionalidad: {
        Row: {
          activo: boolean;
          codigo: string;
          created_at: string;
          descripcion: string | null;
          id: string;
          nombre: string;
          orden: number;
          updated_at: string;
        };
        Insert: {
          activo?: boolean;
          codigo: string;
          created_at?: string;
          descripcion?: string | null;
          id?: string;
          nombre: string;
          orden?: number;
          updated_at?: string;
        };
        Update: {
          activo?: boolean;
          codigo?: string;
          created_at?: string;
          descripcion?: string | null;
          id?: string;
          nombre?: string;
          orden?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      agrupaciones_marca: {
        Row: {
          activo: boolean;
          codigo: string;
          created_at: string;
          id: string;
          nombre: string;
          orden: number;
          updated_at: string;
        };
        Insert: {
          activo?: boolean;
          codigo: string;
          created_at?: string;
          id?: string;
          nombre: string;
          orden?: number;
          updated_at?: string;
        };
        Update: {
          activo?: boolean;
          codigo?: string;
          created_at?: string;
          id?: string;
          nombre?: string;
          orden?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      agrupaciones_talla: {
        Row: {
          activo: boolean;
          codigo: string;
          created_at: string;
          id: string;
          nombre: string;
          orden: number;
          updated_at: string;
        };
        Insert: {
          activo?: boolean;
          codigo: string;
          created_at?: string;
          id?: string;
          nombre: string;
          orden?: number;
          updated_at?: string;
        };
        Update: {
          activo?: boolean;
          codigo?: string;
          created_at?: string;
          id?: string;
          nombre?: string;
          orden?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      equivalencias: {
        Row: {
          activo: boolean;
          agrupacion_estacionalidad_id: string | null;
          codigo: string;
          created_at: string;
          es_generica: boolean;
          genero_mundo_linea_id: string;
          id: string;
          nombre: string;
          updated_at: string;
        };
        Insert: {
          activo?: boolean;
          agrupacion_estacionalidad_id?: string | null;
          codigo: string;
          created_at?: string;
          es_generica?: boolean;
          genero_mundo_linea_id: string;
          id?: string;
          nombre: string;
          updated_at?: string;
        };
        Update: {
          activo?: boolean;
          agrupacion_estacionalidad_id?: string | null;
          codigo?: string;
          created_at?: string;
          es_generica?: boolean;
          genero_mundo_linea_id?: string;
          id?: string;
          nombre?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "equivalencias_agrupacion_estacionalidad_id_fkey";
            columns: ["agrupacion_estacionalidad_id"];
            isOneToOne: false;
            referencedRelation: "agrupaciones_estacionalidad";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "equivalencias_genero_mundo_linea_id_fkey";
            columns: ["genero_mundo_linea_id"];
            isOneToOne: false;
            referencedRelation: "genero_mundo_linea";
            referencedColumns: ["id"];
          },
        ];
      };
      genero_mundo_linea: {
        Row: {
          activo: boolean;
          created_at: string;
          genero_id: string;
          id: string;
          linea_id: string;
          mundo_id: string;
          updated_at: string;
        };
        Insert: {
          activo?: boolean;
          created_at?: string;
          genero_id: string;
          id?: string;
          linea_id: string;
          mundo_id: string;
          updated_at?: string;
        };
        Update: {
          activo?: boolean;
          created_at?: string;
          genero_id?: string;
          id?: string;
          linea_id?: string;
          mundo_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "genero_mundo_linea_genero_id_fkey";
            columns: ["genero_id"];
            isOneToOne: false;
            referencedRelation: "generos";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "genero_mundo_linea_linea_id_fkey";
            columns: ["linea_id"];
            isOneToOne: false;
            referencedRelation: "lineas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "genero_mundo_linea_mundo_id_fkey";
            columns: ["mundo_id"];
            isOneToOne: false;
            referencedRelation: "mundos";
            referencedColumns: ["id"];
          },
        ];
      };
      generos: {
        Row: {
          activo: boolean;
          codigo: string;
          created_at: string;
          id: string;
          nombre: string;
          orden: number;
          updated_at: string;
        };
        Insert: {
          activo?: boolean;
          codigo: string;
          created_at?: string;
          id?: string;
          nombre: string;
          orden?: number;
          updated_at?: string;
        };
        Update: {
          activo?: boolean;
          codigo?: string;
          created_at?: string;
          id?: string;
          nombre?: string;
          orden?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      lineas: {
        Row: {
          activo: boolean;
          codigo: string;
          created_at: string;
          id: string;
          nombre: string;
          temporada: string;
          updated_at: string;
        };
        Insert: {
          activo?: boolean;
          codigo: string;
          created_at?: string;
          id?: string;
          nombre: string;
          temporada?: string;
          updated_at?: string;
        };
        Update: {
          activo?: boolean;
          codigo?: string;
          created_at?: string;
          id?: string;
          nombre?: string;
          temporada?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      marcas: {
        Row: {
          activo: boolean;
          agrupacion_marca_id: string;
          codigo: string;
          created_at: string;
          id: string;
          nombre: string;
          nota_tratamiento: string | null;
          tratamiento_especial: boolean;
          updated_at: string;
        };
        Insert: {
          activo?: boolean;
          agrupacion_marca_id: string;
          codigo: string;
          created_at?: string;
          id?: string;
          nombre: string;
          nota_tratamiento?: string | null;
          tratamiento_especial?: boolean;
          updated_at?: string;
        };
        Update: {
          activo?: boolean;
          agrupacion_marca_id?: string;
          codigo?: string;
          created_at?: string;
          id?: string;
          nombre?: string;
          nota_tratamiento?: string | null;
          tratamiento_especial?: boolean;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "marcas_agrupacion_marca_id_fkey";
            columns: ["agrupacion_marca_id"];
            isOneToOne: false;
            referencedRelation: "agrupaciones_marca";
            referencedColumns: ["id"];
          },
        ];
      };
      mundos: {
        Row: {
          activo: boolean;
          codigo: string;
          created_at: string;
          id: string;
          nombre: string;
          orden: number;
          updated_at: string;
        };
        Insert: {
          activo?: boolean;
          codigo: string;
          created_at?: string;
          id?: string;
          nombre: string;
          orden?: number;
          updated_at?: string;
        };
        Update: {
          activo?: boolean;
          codigo?: string;
          created_at?: string;
          id?: string;
          nombre?: string;
          orden?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      perfiles: {
        Row: {
          id: string;
          email: string;
          nombre: string | null;
          rol: string;
          activo: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          nombre?: string | null;
          rol?: string;
          activo?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          nombre?: string | null;
          rol?: string;
          activo?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      tiendas: {
        Row: {
          activo: boolean;
          codigo: string;
          created_at: string;
          fecha_apertura: string | null;
          fecha_cierre: string | null;
          id: string;
          nombre: string;
          razon_social: string | null;
          tipo: string;
          updated_at: string;
          venta_esperada_promedio: number | null;
          zona: string | null;
        };
        Insert: {
          activo?: boolean;
          codigo: string;
          created_at?: string;
          fecha_apertura?: string | null;
          fecha_cierre?: string | null;
          id?: string;
          nombre: string;
          razon_social?: string | null;
          tipo?: string;
          updated_at?: string;
          venta_esperada_promedio?: number | null;
          zona?: string | null;
        };
        Update: {
          activo?: boolean;
          codigo?: string;
          created_at?: string;
          fecha_apertura?: string | null;
          fecha_cierre?: string | null;
          id?: string;
          nombre?: string;
          razon_social?: string | null;
          tipo?: string;
          updated_at?: string;
          venta_esperada_promedio?: number | null;
          zona?: string | null;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

type PublicSchema = Database["public"];

export type Tables<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Row"];
export type TablesInsert<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Update"];
