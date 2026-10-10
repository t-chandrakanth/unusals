// Shared database connection (Supabase).
//
// Leave both empty and the app keeps its data on the device only.
// Fill both in and the app asks everyone to sign in and keeps the data in
// the database, shared by all users.
//
// The key below is the project's public "anon" key. It is meant to be
// visible in the app: on its own it gives no access to the data. Access comes
// from signing in, enforced by the rules in supabase/setup.sql.

export const SUPABASE_URL = '';
export const SUPABASE_KEY = '';
