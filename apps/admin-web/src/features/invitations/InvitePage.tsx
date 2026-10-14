import { useFragmentSecret } from "../../shared/utilities/fragment";
import { InvalidLink } from "../../shared/InvalidLink";

export function InvitePage() {
  const token = useFragmentSecret();
  if (!token) return <InvalidLink />;

  // Preview and accept (POST /api/v1/invitations/preview, /accept) come with sign-in.
  return (
    <main className="tp-page">
      <div className="tp-card">
        <h1>הוזמנת לצוות הסטודיו</h1>
        <p>כדי לאשר את ההזמנה, יש להתחבר או להירשם.</p>
      </div>
    </main>
  );
}
