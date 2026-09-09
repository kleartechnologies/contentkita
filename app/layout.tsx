import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { Toaster } from "sonner";

import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jakarta",
});

export const metadata: Metadata = {
  title: {
    default: "ContentKita — 30 hari content khas untuk restoran anda",
    template: "%s · ContentKita",
  },
  description:
    "ContentKita bantu restoran, kafe dan kedai makan di Malaysia merancang content media sosial untuk 30 hari. Isi maklumat bisnes anda, terus dapat caption, hook dan idea gambar.",
  applicationName: "ContentKita",
  keywords: [
    "content restoran",
    "social media restoran Malaysia",
    "caption Instagram kedai makan",
    "content plan F&B",
  ],
};

export const viewport: Viewport = {
  themeColor: "#fdfcfa",
  // The onboarding form is long; pinch-zoom stays available on purpose.
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ms" className={jakarta.variable}>
      <body className="min-h-dvh antialiased">
        {children}
        <Toaster
          position="top-center"
          offset={16}
          toastOptions={{
            style: {
              background: "var(--color-ink)",
              color: "#fff",
              border: "none",
              borderRadius: "0.75rem",
            },
          }}
        />
      </body>
    </html>
  );
}
