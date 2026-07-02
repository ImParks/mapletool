import type { MetadataRoute } from "next";

// TODO: 192x192 / 512x512 PNG(마스커블 포함) 아이콘이 아직 없다. 실제 이미지 생성 도구를
// 확보하면 public/icon-192.png, public/icon-512.png 를 추가하고 아래 icons 배열에 등록한다.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "메이플 숙제 헌터",
    short_name: "숙제헌터",
    description: "메이플스토리 일일·주간·보스 숙제를 한 눈에 체크하는 트래커",
    start_url: "/",
    display: "standalone",
    background_color: "#eef1f8",
    theme_color: "#f5851f",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
