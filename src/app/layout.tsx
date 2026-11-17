import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { UploadProvider } from "@/components/uploads/upload-provider";

const NAV = [
  { href: "/", label: "School" },
  { href: "/project", label: "Project" },
  { href: "/planning", label: "Planning" },
  { href: "/bibliotheek", label: "Bibliotheek" },
  { href: "/assistent", label: "Assistent" },
  { href: "/settings", label: "Instellingen" },
];

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "piet-hva",
  description: "Piets HvA-schoolhub",
  // "Add to Home Screen" on iOS then opens it full-screen, like an app.
  appleWebApp: { capable: true, title: "piet-hva" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-dvh antialiased`}
      suppressHydrationWarning
    >
      <body
        className="h-dvh flex flex-col bg-background text-foreground"
        suppressHydrationWarning
      >
        <UploadProvider>
          <header className="border-b border-border px-4 md:px-6 py-3 flex items-center gap-4 md:gap-6 overflow-x-auto">
            <Link href="/" className="font-semibold tracking-tight text-primary shrink-0">
              piet-hva
            </Link>
            <nav className="flex gap-4 text-sm text-muted-foreground">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="hover:text-foreground transition-colors shrink-0"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </header>
          <main className="flex-1 flex flex-col min-h-0 overflow-y-auto">
            {children}
          </main>
        </UploadProvider>
        <Toaster />
      </body>
    </html>
  );
}
