import type { Metadata } from "next";
import "./globals.css";
import { EngineWarmer } from "@/components/EngineWarmer";

/** VenueIQ mark — three graduated bars, tilted. Reads as a crowd-density ramp. */
const MARK = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='white'%3E%3Cg transform='rotate(-30 12 12)'%3E%3Crect x='4.2' y='11.6' width='3.5' height='8.4' rx='1.75'/%3E%3Crect x='10.25' y='7.6' width='3.5' height='12.4' rx='1.75'/%3E%3Crect x='16.3' y='3.6' width='3.5' height='16.4' rx='1.75'/%3E%3C/g%3E%3C/svg%3E";

export const metadata: Metadata = {
  title: "VenueIQ — Crowd intelligence for mega-venues",
  description:
    "VenueIQ reads mobile-network congestion as an early indicator of crowd pressure, forecasts it 30 minutes ahead with a multi-agent brain, and reroutes guests before a zone fills.",
  icons: { icon: [{ url: MARK, type: "image/svg+xml" }] },
};

export const viewport = {
  themeColor: "#000000",
  colorScheme: "dark" as const,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900&family=Instrument+Serif:ital@1&family=IBM+Plex+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {children}
        <EngineWarmer />
      </body>
    </html>
  );
}
