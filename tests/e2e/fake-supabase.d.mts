import type { PGlite } from '@electric-sql/pglite';
export const JWT_SECRET: string;
export const ANON_KEY: string;
export const SERVICE_ROLE_KEY: string;
export const BUCKET: string;
export const USER_1: { id: string; email: string; password: string };
export const USER_2: { id: string; email: string; password: string };
export function signJwt(payload: Record<string, unknown>, secret?: string): string;
export function verifyJwt(token: string, secret?: string): Record<string, any>;
export interface FakeSupabase {
  url: string; port: number; anonKey: string; serviceRoleKey: string; jwtSecret: string;
  users: { user1: typeof USER_1; user2: typeof USER_2 };
  db: PGlite;
  close(): Promise<void>;
}
export function startFakeSupabase(opts?: { port?: number; host?: string }): Promise<FakeSupabase>;
