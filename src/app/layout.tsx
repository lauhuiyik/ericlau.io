import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Eric Lau — Creative.",
  description:
    "The work, experiments and notes of Eric Lau — cinematography, photography, animation, industrial design, branding, activation, and a log of AI experiments.",
  metadataBase: new URL("https://ericlau.io"),
  openGraph: {
    title: "Eric Lau — Creative.",
    description: "The work, experiments and notes of Eric Lau.",
    url: "https://ericlau.io",
    siteName: "Eric Lau",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
