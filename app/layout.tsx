import type { ReactNode } from "react";
import { Inter, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import Nav from "./nav";
import { formatUsNumber, siteInfo } from "@/lib/public-data";

const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata = {
  title: "Ella console · JR&CO Roofing",
  description: "Calls, leads and test results for Ella, the AI receptionist for JR&CO Roofing (fictional client).",
};

function RoofMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M1.5 8.5 8 3l6.5 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 7.5V13h8V7.5" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

export default function RootLayout({ children }: { children: ReactNode }) {
  const site = siteInfo();
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <header className="topbar">
          <div className="topbar-inner">
            <Link href="/" className="brand">
              <span className="brand-mark"><RoofMark /></span>
              <span>{site.businessName}</span>
              <span className="brand-sub">/ {site.agentName}</span>
            </Link>
            <Nav />
            <div className="topbar-right">
              {site.number && (
                <a className="mono muted nowrap" href={`tel:${site.number}`} title={`Call ${site.agentName}`}>
                  {formatUsNumber(site.number)}
                </a>
              )}
              <Link className="btn btn-primary" href="/#talk">Talk to {site.agentName}</Link>
            </div>
          </div>
        </header>
        {children}
        <footer className="footer">
          {site.businessName} is a fictional client; this is an assessment build. Demo and test calls are shown in full;
          real calls are listed with personal details, transcripts and recordings hidden.
        </footer>
      </body>
    </html>
  );
}
