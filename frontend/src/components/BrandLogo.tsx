import logoPng from "../assets/liangce-logo.png";

type Props = {
  size?: number;
  className?: string;
  alt?: string;
};

export const BRAND_LOGO_SRC = logoPng;

export default function BrandLogo({ size = 36, className = "", alt = "良策" }: Props) {
  return (
    <img
      src={logoPng}
      alt={alt}
      width={size}
      height={size}
      className={`brand-logo ${className}`.trim()}
      draggable={false}
    />
  );
}
