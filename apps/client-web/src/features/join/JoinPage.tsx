import { useFragmentSecret } from "../../shared/utilities/fragment";
import { InvalidLink } from "../../shared/InvalidLink";

export function JoinPage() {
  const code = useFragmentSecret();
  if (!code) return <InvalidLink />;

  // Join preview and join (POST /api/v1/join/preview, /join) come with packages/api-client.
  return (
    <main className="tp-page">
      <div className="tp-card">
        <h1>הצטרפות לסטודיו</h1>
        <p>כדי להצטרף, יש להתחבר או להירשם.</p>
      </div>
    </main>
  );
}
