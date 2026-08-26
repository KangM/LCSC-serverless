import type { Metadata } from "next";
import { ToastProvider } from "@/components/Toast";
import "./globals.css";

export const metadata: Metadata = {
  title: "元件库存管理",
  description: "基于立创商城数据的个人库存管理系统",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="zh-CN"
      className="h-full antialiased"
    >
      {/* suppressHydrationWarning：浏览器扩展（如缩放/翻译类）会往 <body> 注入 style，触发 hydration 告警 */}
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
