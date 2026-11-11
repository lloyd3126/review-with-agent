import {Geist, Geist_Mono} from 'next/font/google';
import './globals.css';

const geistSans = Geist({variable: '--font-geist-sans', subsets: ['latin']});
const geistMono = Geist_Mono({variable: '--font-geist-mono', subsets: ['latin']});

export const metadata = {
  title: 'Review with Agent',
  description: '上傳 PDF 文件與參考資料，依編號與 Agent 討論並逐步改善。',
};

export default function Layout({children}) {
  return <html lang="zh-Hant"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>;
}
