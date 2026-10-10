// Shared database connection (Supabase).
//
// Leave URL and KEY empty and the app keeps its data on the device only.
// Fill both in and the app keeps the data in the database, shared by
// everyone who opens it.
//
// The key is the project's public "anon" key, which is meant to be visible in
// the app. Never put the service_role key or the database password here.

export const SUPABASE_URL = '';
export const SUPABASE_KEY = '';

// false: anyone who opens the app link can view and edit. No sign-in.
//        Use together with supabase/setup.sql.
// true:  each person signs in with an email and password that you create in
//        Supabase. Use together with supabase/setup-login.sql.
export const REQUIRE_LOGIN = false;
