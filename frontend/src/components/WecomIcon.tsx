/** 企业微信品牌图标(区别于个人微信绿色) */
export default function WecomIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect x="2" y="3" width="20" height="15" rx="4" fill="currentColor" />
      <path
        d="M8 17.5c-2.2 1.2-4.5 1.8-6 2.2 1.1-1.4 1.8-2.8 2.2-4.2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="9" cy="10" r="1.1" fill="#fff" />
      <circle cx="12" cy="10" r="1.1" fill="#fff" />
      <circle cx="15" cy="10" r="1.1" fill="#fff" />
    </svg>
  );
}
