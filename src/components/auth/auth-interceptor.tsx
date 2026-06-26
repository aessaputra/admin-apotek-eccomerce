import { useEffect } from "react";
import { useNavigate } from "react-router";
import { supabaseClient } from "../../providers/supabase-client";

export function AuthInterceptor() {
  const navigate = useNavigate();

  useEffect(() => {
    const {
      data: { subscription },
    } = supabaseClient.auth.onAuthStateChange((event) => {
      const hash = window.location.hash;
      const isInviteFlow = hash.includes("type=invite") || hash.includes("type=recovery");

      if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && isInviteFlow)) {
        navigate("/update-password", { replace: true });
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [navigate]);

  return null;
}
