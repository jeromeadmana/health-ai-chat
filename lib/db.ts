import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

// Neon's HTTP driver — no persistent connections, no WebSocket, no extra
// dependencies. Ideal for Vercel serverless (free tier) where each request is
// short-lived. Lazily initialised so `next build` doesn't fail when the env
// var is absent at build time.
let _sql: NeonQueryFunction<false, false> | null = null;

export function getSql(): NeonQueryFunction<false, false> {
  if (!_sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    _sql = neon(url);
  }
  return _sql;
}

// Helper that always returns a plain rows array regardless of driver shape.
export async function query<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const sql = getSql();
  const result = await sql.query(text, params);
  return (Array.isArray(result) ? result : (result as { rows: T[] }).rows) as T[];
}
