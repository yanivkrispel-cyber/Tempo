import { Banner } from "./design-system";

export function InvalidLink() {
  return (
    <main className="tp-page tp-page--center">
      <Banner tone="danger" icon="info">
        הקישור לא תקין. בקשו מהסטודיו קישור חדש.
      </Banner>
    </main>
  );
}
