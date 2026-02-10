import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { GatewayProvider } from "@/components/providers/gateway-provider";
import { Sidebar } from "@/components/layout/sidebar";
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
  title: "PonyBunny",
  description: "Autonomous AI Employee System - Gateway + Scheduler Architecture",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased h-screen overflow-hidden`}
      >
        <GatewayProvider>
          <div className="flex h-full">
            <Sidebar />
            <main className="flex-1 overflow-hidden bg-background">
              {children}
            </main>
          </div>
          <Toaster />
        </GatewayProvider>
      </body>
    </html>
  );
}
