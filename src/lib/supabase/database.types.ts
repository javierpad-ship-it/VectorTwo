/**
 * Tipos de la base de datos.
 *
 * Verificados el 2026-10-05 contra `generate_typescript_types` del proyecto
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
