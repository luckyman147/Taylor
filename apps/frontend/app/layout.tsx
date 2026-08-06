import type { Metadata } from 'next';
import { Inter, Space_Grotesk, Newsreader } from 'next/font/google';
import './(default)/css/globals.css';

const spaceGrotesk = Space_Grotesk({
  variable: '--font-space-grotesk',
  subsets: ['latin'],
  display: 'swap',
});

const inter = Inter({
  variable: '--font-sans',
  subsets: ['latin'],
  display: 'swap',
});

const newsreader = Newsreader({
  variable: '--font-serif',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Taylor',
  description: 'Build your resume with Taylor',
  applicationName: 'Taylor',
  keywords: ['resume', 'matcher', 'job', 'application'],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-US" className="h-full" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${spaceGrotesk.variable} ${newsreader.variable} antialiased bg-background text-ink-soft min-h-full`}
      >
        {children}
      </body>
    </html>
  );
}
