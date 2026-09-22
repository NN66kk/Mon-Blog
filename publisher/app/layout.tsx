import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Mon · 写作室',
  description: 'Mon 的私人博客管理平台：文章、草稿、图片、历史版本与发布。',
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="stylesheet" href="/fonts/lxgw-wenkai/style.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
