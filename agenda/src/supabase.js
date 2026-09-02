import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const configurada = Boolean(url && key);
export const supabase = configurada ? createClient(url, key) : null;
