import { Image } from "antd";

type AvatarPreviewProps = {
  src: string;
  size?: number;
  alt?: string;
  className?: string;
};

export function AvatarPreview({ src, size = 56, alt = "头像", className }: AvatarPreviewProps) {
  return (
    <div
      className={["avatar-preview-shell", className].filter(Boolean).join(" ")}
      style={{ width: size, height: size }}
    >
      <Image src={src} alt={alt} preview={{ mask: "查看大图" }} />
    </div>
  );
}
