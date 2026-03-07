import type { Metadata } from "next";
import "./globals.scss";
import { SideNav } from "./SideNav";
import { MobileNav } from "./MobileNav";
import { ThemeProvider } from "./ThemeProvider";

export const metadata: Metadata = {
  title: "bashkit",
  description: "The Claude Agents SDK for the Vercel AI SDK",
  icons: {
    icon: "/favicon.svg",
  },
  openGraph: {
    title: "bashkit",
    description: "The Claude Agents SDK for the Vercel AI SDK",
    images: [{ url: "/og.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "bashkit",
    description: "The Claude Agents SDK for the Vercel AI SDK",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <ThemeProvider>
          <MobileNav />
          <SideNav />
          <main className="main-content">{children}</main>
        </ThemeProvider>
      </body>
    </html>
  );
}
