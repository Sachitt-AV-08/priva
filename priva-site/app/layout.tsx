import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Sora } from "next/font/google";
import "./globals.css";
import "./app.css";
import { AuthProvider } from "../lib/auth";

const sora = Sora({
  subsets: ["latin"],
  weight: ["700", "800"],
  variable: "--font-sora",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://sachitt-av-08.github.io"),
  title: "PRIVA — Where Notes Become Purchases.",
  description: "Write naturally. Discover intelligently. Purchase confidently.",
  openGraph: {
    title: "PRIVA — Where Notes Become Purchases.",
    description: "Write naturally. Discover intelligently. Purchase confidently.",
    images: ["/priva/priva.png"],
  },
  icons: { icon: "/priva/priva.png" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${sora.variable} ${inter.variable} ${jetBrainsMono.variable}`}>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
