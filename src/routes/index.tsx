import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "GIM Battle — combat d'arène multijoueur en ligne" },
      { name: "description", content: "Bleus contre Rouges dans la salle de classe : crée une partie avec ton code de salon et joue en ligne avec tes amis." },
      { property: "og:title", content: "GIM Battle" },
      { property: "og:description", content: "Combat d'arène 3D multijoueur dans le navigateur, parties privées avec code de salon." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <iframe
      src="/gim/client/index.html"
      title="GIM Battle"
      allow="fullscreen; autoplay; gamepad; screen-wake-lock"
      allowFullScreen
      className="fixed inset-0 h-full w-full border-0 bg-background"
    />
  );
}
