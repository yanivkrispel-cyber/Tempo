import { Link } from "react-router";

export function NotFoundPage() {
  return (
    <main className="tp-page tp-page--center">
      <div className="tp-empty">
        <h1>הדף לא נמצא</h1>
        <Link className="tp-btn tp-btn--secondary" to="/">
          לדף הבית
        </Link>
      </div>
    </main>
  );
}
