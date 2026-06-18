export default function Logo({ className = "h-8" }: { className?: string }) {
  return <img src="/logo.svg" alt="Furora" className={className} />;
}
