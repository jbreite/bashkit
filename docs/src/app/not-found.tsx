import Link from "next/link";
import { Footer } from "./Footer";

export default function NotFound() {
  return (
    <>
      <article className="article">
        <header>
          <h1>404</h1>
          <p className="tagline">Page not found.</p>
        </header>
        <section>
          <p>
            The page you&apos;re looking for doesn&apos;t exist.{" "}
            <Link href="/" className="styled-link">
              Go back home
            </Link>
            .
          </p>
        </section>
      </article>
      <Footer />
    </>
  );
}
