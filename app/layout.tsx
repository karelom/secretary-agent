import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Secretary Agent',
  description: 'A local-first personal assistant powered by Pi.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
