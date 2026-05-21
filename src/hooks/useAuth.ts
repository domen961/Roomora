import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

interface AuthState {
  user: User | null;
  isSuperadmin: boolean;
  loading: boolean;
}

export function useAuth(): AuthState {
  const [user,          setUser]          = useState<User | null>(null);
  const [isSuperadmin,  setIsSuperadmin]  = useState(false);
  const [loading,       setLoading]       = useState(true);

  useEffect(() => {
    // Initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      const u = session?.user ?? null;
      setUser(u);
      if (u) fetchSuperadmin(u.id);
      else setLoading(false);
    });

    // Auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null;
      setUser(u);
      if (u) fetchSuperadmin(u.id);
      else { setIsSuperadmin(false); setLoading(false); }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function fetchSuperadmin(userId: string) {
    const { data } = await supabase
      .from("merchants")
      .select("is_superadmin")
      .eq("id", userId)
      .single();
    setIsSuperadmin(data?.is_superadmin ?? false);
    setLoading(false);
  }

  return { user, isSuperadmin, loading };
}
