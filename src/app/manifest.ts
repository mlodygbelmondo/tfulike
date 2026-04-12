import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "tf u like?",
    short_name: "tf u like?",
    description: "The TikTok party guessing game",
    start_url: "/",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#ff2d55",
    orientation: "portrait",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
