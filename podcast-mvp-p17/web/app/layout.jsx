export const metadata = {
  title: "منصة إنتاج البودكاست",
  description: "حوّل سيناريو مكتوب إلى حلقة بودكاست كاملة الصوت",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ar" dir="rtl">
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, Segoe UI, Tahoma, sans-serif", background: "#F6F7F5", color: "#14201E" }}>
        {children}
      </body>
    </html>
  );
}
