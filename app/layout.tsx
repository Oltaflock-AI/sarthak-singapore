import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Sarthak Singapore — AI Sales Engine",
  description: "Real-time voice and WhatsApp AI sales engine for Sarthak Singapore. Powered by Oltaflock.",
  icons: {
    icon: [
      { url: "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect width=%22100%22 height=%22100%22 rx=%2222%22 fill=%22%23c9a85a%22/><text x=%2250%22 y=%2272%22 font-size=%2266%22 font-family=%22-apple-system,sans-serif%22 font-weight=%22700%22 text-anchor=%22middle%22 fill=%22%231a1611%22>S</text></svg>" },
    ],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        <script
          // Apply saved theme before paint to avoid a flash of the wrong theme.
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');if(t!=='light'&&t!=='dark'){t='dark';}document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme='dark';}})();`,
          }}
        />
      </head>
      <body>
        <div className="shell">
          <Sidebar />
          <main>
            {children}
            <footer className="foot">
              <span>Oltaflock × Sarthak Singapore</span>
              <span>AI Sales Engine · v1.0</span>
            </footer>
          </main>
        </div>
      </body>
    </html>
  );
}
