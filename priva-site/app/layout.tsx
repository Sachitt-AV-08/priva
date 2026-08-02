import type { Metadata } from "next";
import "./globals.css";
import "./app.css";
import { AuthProvider } from "../lib/auth";

export const metadata: Metadata = {
  metadataBase: new URL("https://sachitt-av-08.github.io/priva"),
  title: "PRIVA — Your iMessage-native AI shopping assistant",
  description:
    "PRIVA reads the notes you already keep, finds the best buys inside your budget, pays with Prava (Visa Intelligent Commerce), and chats with you over Linq SMS.",
  openGraph: {
    title: "PRIVA — Personal Retail Intelligence via Agent",
    description:
      "iMessage-native AI shopping assistant. Notes in, best buys out — budget-checked, ranked, and paid with Prava.",
    images: ["/priva.png"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
