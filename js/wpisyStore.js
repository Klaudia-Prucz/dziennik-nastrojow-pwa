// public/js/wpisyStore.js
import { saveLocal, loadLocal } from "./offline.js";

export const WpisyStore = (() => {
  let _supabase = null;
  let _wpisy = loadLocal("wpisy_cache", []);

  function init({ supabase }) {
    _supabase = supabase;
  }

  function getAll() {
    return _wpisy;
  }

  async function fetchMine() {
    if (!_supabase) throw new Error("WpisyStore: brak supabase");
    const { data: userRes } = await _supabase.auth.getUser();
    const userId = userRes?.user?.id;
    if (!userId) return [];

    const { data, error } = await _supabase
      .from("wpisy")
      .select("*")
      .order("data_wpisu", { ascending: false });

    if (error) throw error;

    _wpisy = data ?? [];
    saveLocal("wpisy_cache", _wpisy); // offline fallback
    return _wpisy;
  }

  async function add({ nastroj, opis, data_wpisu = null }) {
    if (!_supabase) throw new Error("WpisyStore: brak supabase");

    const { data: userRes } = await _supabase.auth.getUser();
    const userId = userRes?.user?.id;
    if (!userId) throw new Error("Brak zalogowanego użytkownika");

    const payload = {
      user_id: userId,
      nastroj,
      opis,
      ...(data_wpisu ? { data_wpisu } : {}),
    };

    const { data, error } = await _supabase.from("wpisy").insert(payload).select().single();
    if (error) throw error;

    _wpisy = [data, ..._wpisy];
    saveLocal("wpisy_cache", _wpisy);
    return data;
  }

  return { init, getAll, fetchMine, add };
})();
