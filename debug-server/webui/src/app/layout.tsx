import type { Metadata } from 'next';
import { DebugProvider } from '@/components/providers/debug-provider';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import './globals.css';

export const metadata: Metadata = {
  title: 'PonyBunny Debug Dashboard',
  description: 'Real-time debugging interface for PonyBunny AI Employee System',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <DebugProvider>
          <div className="flex h-screen">
            <Sidebar />
            <div className="flex flex-1 flex-col">
              <Header />
              <main className="flex-1 overflow-auto">{children}</main>
            </div>
          </div>
        </DebugProvider>
      </body>
    </html>
  );
}
