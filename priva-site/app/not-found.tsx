import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import Logo from "../components/Logo";

export default function NotFound() {
  return (
    <main className="center-page">
      <div className="not-found-content">
        <Logo size="large" />
        <p className="page-kicker">404</p>
        <h1>Lost in the cart.</h1>
        <p>The page you were looking for is no longer here.</p>
        <Link className="btn btn-primary" href="/">
          <ArrowLeft size={14} aria-hidden="true" /> Back home
        </Link>
      </div>
    </main>
  );
}
