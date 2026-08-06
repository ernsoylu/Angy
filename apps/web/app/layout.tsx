import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter, JetBrains_Mono, Source_Serif_4 } from "next/font/google";
import "./globals.css";

const fontUi = Inter({ subsets: ["latin"], variable: "--font-ui" });
const fontBody = Source_Serif_4({ subsets: ["latin"], variable: "--font-body" });
const fontMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Angy",
  description: "Company knowledge, fast.",
};

const themeInit = `(function(){try{var q=new URLSearchParams(location.search).get("theme");var t=q||localStorage.getItem("angy-theme");if(t!=="light"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.dataset.theme=t}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="light"
      suppressHydrationWarning
      className={`${fontUi.variable} ${fontBody.variable} ${fontMono.variable}`}
    >
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        {children}
      </body>
    </html>
  );
}
