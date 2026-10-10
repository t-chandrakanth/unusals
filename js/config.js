// Shared database connection (Supabase).
//
// Leave URL and KEY empty and the app keeps its data on the device only.
// Fill both in and the app keeps the data in the database, shared by
// everyone who opens it.
//
// The key is the project's public "anon" key, which is meant to be visible in
// the app. Never put the service_role key or the database password here.

export const SUPABASE_URL = 'https://igfeeyeyumfqmokuexqe.supabase.co';
export const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnZmVleWV5dW1mcW1va3VleHFlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE2MDA3MDMsImV4cCI6MjEwNzE3NjcwM30.MWY_3hdwOmIFG8YpPhRMgcm3XkJV-J_II5ywr9-iI8U';

// false: anyone who opens the app link can view and edit. No sign-in.
//        Use together with supabase/setup.sql.
// true:  each person signs in with an email and password that you create in
//        Supabase. Use together with supabase/setup-login.sql.
export const REQUIRE_LOGIN = false;
