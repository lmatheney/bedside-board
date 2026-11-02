import Link from "next/link";

export function Shell({
  children,
  wide = false,
  links = [],
}: {
  children: React.ReactNode;
  wide?: boolean;
  links?: { href: string; label: string }[];
}) {
  return (
    <div className={wide ? "shell wide" : "shell"}>
      <header className="topbar">
        <span className="brand">Bedside</span>
        {links.length > 0 && (
          <nav>
            {links.map((link) => (
              <Link key={link.href} href={link.href}>
                {link.label}
              </Link>
            ))}
          </nav>
        )}
      </header>
      <main>{children}</main>
    </div>
  );
}
