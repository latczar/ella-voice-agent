import type { ReactNode } from "react";

export const metadata = {
  title: "Ella – JR&CO Roofing",
  description: "AI voice receptionist for JR&CO Roofing (fictional client, assessment build).",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, background: "#f7f7f5", color: "#1d1d1b" }}>
        {children}
      </body>
    </html>
  );
}
