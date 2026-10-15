import { Outlet } from "react-router";
import { errorMessage } from "../api/errors";
import { useAuth } from "../auth/AuthProvider";
import { Banner, Button, Skeleton } from "../shared/design-system";
import { useMe } from "./account";

/** Renders the child routes once the account is loaded (`POST /api/v1/session`). Goes inside <RequireAuth>. */
export function RequireAccount() {
  const me = useMe();
  const { client } = useAuth();

  if (me.data) return <Outlet />;

  if (me.isError) {
    return (
      <main className="tp-page tp-stack">
        <Banner tone="danger" icon="info">
          {errorMessage(me.error, "לא הצלחנו לטעון את החשבון. נסו שוב.")}
        </Banner>
        <div className="tp-row">
          <Button variant="secondary" onClick={() => void me.refetch()}>
            ניסיון נוסף
          </Button>
          <Button variant="ghost" onClick={() => client?.signOut()}>
            התנתקות
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="tp-page tp-stack" aria-busy="true">
      <span className="tp-sr-only">טוענים את החשבון…</span>
      <Skeleton height={56} />
      <Skeleton height={240} />
    </main>
  );
}
